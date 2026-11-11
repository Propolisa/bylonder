// @ts-nocheck
// SPDX-License-Identifier: MIT OR Apache-2.0
// From babylon-blender-rig (scripts/native-rig.mjs).
import { Matrix, Vector3, Quaternion } from '@babylonjs/core/Maths/math.vector.js';
import { ConstraintSolver } from './solver.js';
import { mul, invert, identity } from './math.js';

// Attaches Blender constraint stacks to Babylon TransformNodes and skeleton bones and evaluates them each frame,
// after animations and before rendering. Constraint settings use Blender's Python names (see solver.js).
//
// Coordinates: the solver works in Blender's frame. `axis` (a Babylon Matrix or column-major array) maps Blender
// coordinates to the scene's (for example a glTF import's root world matrix times the Z-up to Y-up rotation);
// without it the scene is taken to be in Blender's coordinates (a right-handed scene with Z up).
//
// Writes: constrained nodes get their world matrix frozen to the result for the frame and unfrozen after render;
// bones get their local matrix for the frame and their own position, rotation and scaling back after render, so
// animation and user code keep owning the basis.
export class BlenderConstraints {
  constructor(scene, { axis = null, types } = {}) {
    this.scene = scene;
    this.solver = new ConstraintSolver(types ? { types } : undefined);
    this.axis = axis ? toF64(axis) : null;
    this.axisInv = this.axis ? invert(this.axis) : null;
    this.nodes = new Map(); // solver name -> { node, frozen: Matrix }
    this.armatures = new Map(); // solver name -> { skeleton, node, bones: Map name -> { bone, restLocal, saved } }
    this._before = scene.onBeforeRenderObservable.add(() => this.update());
    this._after = scene.onAfterRenderObservable.add(() => this.release());
  }

  dispose() {
    this.scene.onBeforeRenderObservable.remove(this._before);
    this.scene.onAfterRenderObservable.remove(this._after);
    this.release();
  }

  // Constraint stack of a node (an object). Targets and space objects are found by name and registered on demand.
  // `rotationMode`: Blender's rotation mode of the object (Euler order for AUTO orders), default XYZ.
  setObjectConstraints(node, constraints, { parentInverse = null, rotationMode } = {}) {
    const ob = this.registerNode(node);
    ob.constraints = constraints;
    if (rotationMode) ob.rotationMode = rotationMode;
    if (parentInverse) ob.parentInverse = toF64(parentInverse);
    return ob;
  }

  // An armature: `node` holds the armature's world matrix; `lengths` gives bone lengths (default: bone.length or 1),
  // `flags` per bone Blender's bone flags (use_connect, use_inherit_rotation, inherit_scale, use_local_location),
  // `rotationModes` per bone (default QUATERNION, as Blender's pose bones), `ik` per bone its IK settings
  // (lock_ik_*, ik_stiffness_*, ik_stretch).
  addArmature(name, skeleton, node, { lengths = {}, flags = {}, rotationModes = {}, ik = {} } = {}) {
    const ob = this.registerNode(node, name);
    const restWorld = new Map(), bones = new Map(), desc = [];
    for (const bone of skeleton.bones) {
      const parent = bone.getParent();
      const restLocal = this.toBlender(toF64(bone.getRestMatrix()));
      const rest = parent ? mul(restWorld.get(parent), restLocal) : restLocal;
      restWorld.set(bone, rest);
      bones.set(bone.name, { bone, restLocal, saved: null });
      desc.push({
        name: bone.name, parent: parent?.name ?? null, rest,
        length: lengths[bone.name] ?? bone.length ?? 1, flags: flags[bone.name] ?? {},
        rotationMode: rotationModes[bone.name] ?? 'QUATERNION', ik: ik[bone.name] ?? {},
      });
    }
    this.solver.setBones(ob, desc);
    this.armatures.set(name, { skeleton, node, bones });
    return ob;
  }

  setBoneConstraints(armatureName, boneName, constraints) {
    this.solver.objects.get(armatureName).bones.get(boneName).constraints = constraints;
  }

  registerNode(node, name = node.name) {
    if (this.solver.objects.has(name)) return this.solver.objects.get(name);
    const parent = node.parent ? this.registerNode(node.parent).name : null;
    this.nodes.set(name, { node, frozen: new Matrix() });
    return this.solver.addObject(name, { parent });
  }

  // A Spline IK target: { splines: [{ type: 'POLY' | 'BEZIER', points: [{ co, left, right, radius, tilt }],
  // resolution_u }], resolution_u } in the node's local Blender coordinates.
  setCurve(node, curve) {
    this.registerNode(node).curve = curve;
  }

  // Registers constraint targets and space objects that are scene nodes not yet known.
  resolveTargets() {
    const want = new Set();
    for (const ob of this.solver.objects.values()) {
      const stacks = [ob.constraints, ...(ob.bones ? [...ob.bones.values()].map((b) => b.constraints) : [])];
      for (const c of stacks.flat()) {
        for (const n of [c.target, c.space_object, c.pole_target, ...(c.targets ?? []).map((t) => t.target)]) if (n) want.add(n);
      }
    }
    for (const n of want) {
      if (this.solver.objects.has(n)) continue;
      const node = this.scene.getTransformNodeByName(n) ?? this.scene.getMeshByName(n);
      if (node) this.registerNode(node, n);
    }
  }

  toBlender(m) {
    return this.axis ? mul(mul(this.axisInv, m), this.axis) : m;
  }

  fromBlender(m) {
    return this.axis ? mul(mul(this.axis, m), this.axisInv) : m;
  }

  // Reads every basis, evaluates and writes the constrained results.
  update() {
    this.release();
    this.resolveTargets();
    for (const [name, { node }] of this.nodes) {
      const ob = this.solver.objects.get(name);
      const local = ob.parent ? localMatrix(node) : toF64(node.computeWorldMatrix(true));
      ob.basis = this.toBlender(local);
    }
    for (const [name, arm] of this.armatures) {
      const ob = this.solver.objects.get(name);
      for (const [boneName, entry] of arm.bones) {
        const local = this.toBlender(boneLocal(entry.bone));
        ob.bones.get(boneName).basis = mul(invert(entry.restLocal), local);
      }
    }
    this.solver.evaluate();
    this.write();
  }

  write() {
    for (const [name, entry] of this.nodes) {
      const ob = this.solver.objects.get(name);
      if (!ob.constraints.length && !this.hasConstrainedAncestor(ob)) continue;
      entry.frozen.fromArray(Array.from(this.fromBlender(ob.world)));
      entry.node.freezeWorldMatrix(entry.frozen);
      entry.isFrozen = true;
    }
    for (const [name, arm] of this.armatures) {
      const ob = this.solver.objects.get(name);
      for (const [boneName, entry] of arm.bones) {
        const b = ob.bones.get(boneName);
        const parentPose = b.parent ? ob.bones.get(b.parent).pose : identity(new Float64Array(16));
        const local = this.fromBlender(mul(invert(parentPose), b.pose));
        entry.saved = saveTRS(entry.bone);
        setBoneLocal(entry.bone, local);
      }
      arm.skeleton.markAsDirty?.();
    }
  }

  hasConstrainedAncestor(ob) {
    for (let p = ob.parent && this.solver.objects.get(ob.parent); p; p = p.parent && this.solver.objects.get(p.parent)) {
      if (p.constraints.length || p.bones) return true;
    }
    return false;
  }

  // Gives the frame's basis back to animation and user code.
  release() {
    for (const entry of this.nodes.values()) {
      if (entry.isFrozen) { entry.node.unfreezeWorldMatrix(); entry.isFrozen = false; }
    }
    for (const arm of this.armatures.values()) {
      for (const entry of arm.bones.values()) {
        if (entry.saved) { restoreTRS(entry.bone, entry.saved); entry.saved = null; }
      }
    }
  }
}

const toF64 = (m) => Float64Array.from(m.m ?? m);

function localMatrix(node) {
  const q = node.rotationQuaternion ?? Quaternion.FromEulerVector(node.rotation);
  return toF64(Matrix.Compose(node.scaling, q, node.position));
}

// A bone's local matrix: its linked node's position, rotation and scaling, else the bone's own.
function boneLocal(bone) {
  const src = bone.getTransformNode?.() ?? bone;
  const q = src.rotationQuaternion ?? Quaternion.FromEulerVector(src.rotation);
  return toF64(Matrix.Compose(src.scaling, q, src.position));
}

function saveTRS(bone) {
  const src = bone.getTransformNode?.() ?? bone;
  return {
    src, position: src.position.clone(), scaling: src.scaling.clone(),
    rotationQuaternion: src.rotationQuaternion?.clone() ?? null, rotation: src.rotation?.clone(),
  };
}

function restoreTRS(bone, s) {
  s.src.position = s.position;
  s.src.scaling = s.scaling;
  if (s.rotationQuaternion) s.src.rotationQuaternion = s.rotationQuaternion;
  else s.src.rotation = s.rotation;
}

// A bone without a linked node keeps the whole local matrix, shear included (Bone's internal `_matrix` setter is
// the only way to set it without touching the bind matrix). A linked node takes position, rotation and scaling, so
// a sheared local matrix loses its shear there.
function setBoneLocal(bone, local) {
  const m = Matrix.FromArray(Array.from(local));
  const node = bone.getTransformNode?.();
  if (!node) { bone._matrix = m; return; }
  const s = new Vector3(), q = new Quaternion(), p = new Vector3();
  m.decompose(s, q, p);
  node.position = p;
  node.scaling = s;
  node.rotationQuaternion = q;
}
