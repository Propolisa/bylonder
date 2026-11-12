// @ts-nocheck
// SPDX-License-Identifier: MIT OR Apache-2.0
// From babylon-blender-rig (scripts/native-rig.mjs).
// The compiled rig: a description is turned once into a flat, topologically ordered list of ops over typed arrays
// (RigProgram). Each RigInstance holds one character's state; evaluate() reruns only the ops whose inputs changed.
//
// Ops: DRIVER (one driver, written into a property), OBJECT (world matrix and constraint stack of an object), BONE
// (pose from parent and basis, then the bone's stack without IK), IK (a chain solved after its bones' stacks; IK and
// Spline IK). Bones of an IK chain write their pre-solve pose to `pre`; the IK op reads it and writes `pose`.
import { mul, invert, translation, translationMatrix } from '../math.js';
import { constraintTypes } from '../constraints/index.js';
import { normalize, rotationValues, rotationCode } from './schema.js';
import { mulAffine, composeBasis, invertAffine, isIdentity, ROT_NAMES } from './m4.js';
import { runConstraint } from './stack.js';
import { fromSpace } from '../spaces.js';
import { blendMatrices } from '../blend.js';
import { poseFromBasisInto } from './inherit.js';
import { compileDrivers, evaluateDriver, resolveProperty, parsePath } from '../drivers/drivers.js';
import { compileDeform, deformMesh } from '../deform/mesh.js';
import { bboneJoints, bboneContext } from '../deform/bbone.js';
import { bboneSegments } from '../deform/joints.js';
import { compileAnimations, evaluateAnimation } from '../anim/animation.js';

const BONE_SPACES = new Set(['LOCAL', 'POSE', 'LOCAL_WITH_PARENT']);
const OP_OBJECT = 0, OP_BONE = 1, OP_IK = 2, OP_DRIVER = 3, OP_ANIM = 4;
const FAST_FLAGS = (b) => b.use_inherit_rotation && b.inherit_scale === 'FULL' && b.use_local_location;
const ROTATION_PROPS = { rotation_quaternion: [0], rotation_axis_angle: [1], rotation_euler: [2, 3, 4, 5, 6, 7] };

export function compileRig(description, options = {}) {
  return new RigProgram(normalize(description), options);
}

export class RigProgram {
  constructor(desc, { types = constraintTypes } = {}) {
    this.types = types;
    this.objects = desc.objects;
    this.objectIndex = new Map(this.objects.map((o, i) => [o.name, i]));
    this.actions = new Map(desc.actions.map((a) => [a.name, a]));
    this.scene = desc.scene;
    this.viewLayer = desc.view_layer;
    this.collectBones();
    this.compileChains();
    this.objects.forEach((o, i) => { o.stack = this.compileStack(o.constraints, { object: i, bone: -1 }); });
    for (const b of this.bones) b.stack = this.compileStack(b.pose.constraints, { object: b.arm, bone: b.index });
    ({ drivers: this.drivers, unsupported: this.unsupported } = compileDrivers(this, desc.drivers));
    this.animations = compileAnimations(this);
    this.buildOps();
  }

  // --- bones: one global table over every armature ---

  collectBones() {
    const bones = [];
    this.objects.forEach((o, oi) => {
      if (!o.bones) return;
      o.boneIndex = new Map();
      for (const b of o.bones) { o.boneIndex.set(b.name, bones.length); bones.push({ ...b, arm: oi, index: bones.length }); }
    });
    const n = bones.length;
    this.bones = bones;
    this.parent = new Int32Array(n).fill(-1);
    this.rest = new Float64Array(n * 16);
    this.offset = new Float64Array(n * 16); // Rp^-1 R, the rest offset from the parent
    this.length = new Float64Array(n);
    this.fast = new Uint8Array(n);
    this.connect = new Uint8Array(n);
    for (const b of bones) {
      const i = b.index, arm = this.objects[b.arm];
      this.rest.set(b.matrix_local, i * 16);
      this.length[i] = b.length;
      this.connect[i] = b.use_connect ? 1 : 0;
      this.fast[i] = FAST_FLAGS(b) ? 1 : 0;
      b.flags = { use_connect: b.use_connect, use_inherit_rotation: b.use_inherit_rotation, inherit_scale: b.inherit_scale, use_local_location: b.use_local_location };
      if (b.parent != null && arm.boneIndex.has(b.parent)) this.parent[i] = arm.boneIndex.get(b.parent);
    }
    for (const b of bones) {
      const i = b.index, p = this.parent[i];
      this.offset.set(p < 0 ? b.matrix_local : mul(invert(this.rest.subarray(p * 16, p * 16 + 16)), b.matrix_local), i * 16);
    }
  }

  // A reference to an object or one of its bones: { object, bone (-1 for the object itself) }, or null if missing.
  ref(name, subtarget) {
    const object = name == null ? undefined : this.objectIndex.get(name);
    if (object === undefined) return null;
    if (!subtarget) return { object, bone: -1 };
    const bone = this.objects[object].boneIndex?.get(subtarget);
    return bone === undefined ? null : { object, bone };
  }

  // A compiled constraint (stack entry or chain) by owner and name, for drivers.
  constraintNamed(object, bone, name) {
    const stack = bone >= 0 ? this.bones[bone].stack : this.objects[object].stack;
    const named = (c) => (c.raw.name ?? defaultName(c.raw.type)) === name;
    return stack?.find(named) ?? this.chains.find((c) => c.owner === bone && named(c)) ?? null;
  }

  // --- IK chains (IK and SPLINE_IK constraints, run after their bones' stacks) ---

  compileChains() {
    this.chains = [];
    this.chainOf = new Int32Array(this.bones.length).fill(-1);
    for (const b of this.bones) {
      for (const c of b.pose.constraints) {
        const type = this.types[c.type];
        if (type?.targets !== 'chain') continue;
        const target = this.ref(c.target, c.subtarget);
        if (!target) continue;
        const members = [];
        const count = c.chain_count ?? type.defaults.chain_count;
        for (let x = b.index; x >= 0 && (!count || members.length < count); x = this.parent[x]) members.unshift(x);
        const s = { ...type.defaults, ...c };
        const chain = {
          index: this.chains.length, owner: b.index, arm: b.arm, type, s, raw: c, members, target,
          pole: c.pole_target ? this.ref(c.pole_target, c.pole_subtarget) : null,
        };
        this.chains.push(chain);
        for (const x of members) if (this.chainOf[x] < 0) this.chainOf[x] = chain.index;
      }
    }
  }

  // Constraints other than chains, with settings merged over the type's defaults and targets resolved.
  // The bones whose poses shape a B-Bone besides itself: its parent and connected child (automatic handles) and its
  // custom handles.
  bboneShapeBones(b) {
    const bone = this.bones[b], arm = this.objects[bone.arm], out = [];
    if (this.parent[b] >= 0 && bone.use_connect) out.push(this.parent[b]);
    for (const k of this.bones) if (this.parent[k.index] === b && k.use_connect) out.push(k.index);
    for (const end of ['start', 'end']) {
      const i = arm.boneIndex.get(bone[`bbone_custom_handle_${end}`] ?? '');
      if (i !== undefined) out.push(i);
    }
    return out;
  }

  compileStack(constraints, owner) {
    const out = [];
    for (const c of constraints) {
      const type = this.types[c.type];
      if (!type || type.targets === 'chain') continue;
      const s = { ...type.defaults, ...c };
      const entry = { type, s, raw: c, owner, target: null, targets: null, targetList: null, custom: null, valid: true };
      if (type.targets === 'multi') {
        entry.targetList = (c.targets ?? []).map((t) => ({ ...t, ref: this.ref(t.target, t.subtarget) }));
        entry.targets = entry.targetList.filter((t) => t.ref);
      } else if (type.targets !== 'none') {
        entry.target = this.ref(c.target, c.subtarget);
        if (!entry.target && type.targets !== 'optional') entry.valid = false;
      }
      if (c.space_object) entry.custom = this.ref(c.space_object, c.space_subtarget);
      type.compile?.(s, { program: this, owner });
      out.push(entry);
    }
    return out;
  }

  // --- ops in dependency order ---

  buildOps() {
    const ops = [];
    const objectOp = this.objects.map((o, i) => ops.push({ kind: OP_OBJECT, node: i }) - 1);
    const boneOp = this.bones.map((b) => ops.push({ kind: OP_BONE, node: b.index }) - 1);
    const chainOp = this.chains.map((c) => ops.push({ kind: OP_IK, node: c.index }) - 1);
    const driverOp = this.drivers.map((d, i) => ops.push({ kind: OP_DRIVER, node: i }) - 1);
    const animOp = this.animations.map((a, i) => ops.push({ kind: OP_ANIM, node: i }) - 1);
    const finalOf = (r) => (r.bone < 0 ? objectOp[r.object] : this.chainOf[r.bone] >= 0 ? chainOp[this.chainOf[r.bone]] : boneOp[r.bone]);
    // A constraint reading a B-Bone's segments (Armature targets, Follow B-Bone Shape) also waits for the bones that
    // shape them: the B-Bone's handles.
    const shapeRefs = (r) => (r.bone >= 0 && (this.bones[r.bone].bbone_segments ?? 1) > 1 ? this.bboneShapeBones(r.bone).map((bone) => ({ object: r.object, bone })) : []);
    const stackDeps = (stack) => stack.flatMap((e) => [
      e.target, e.custom, ...(e.targets ?? []).map((t) => t.ref),
      ...(e.raw.type === 'ARMATURE' ? (e.targets ?? []).flatMap((t) => shapeRefs(t.ref)) : []),
      ...(e.raw.use_bbone_shape && e.target ? shapeRefs(e.target) : []),
    ].filter(Boolean).map(finalOf));
    const inputOp = (r) => (r.bone >= 0 ? boneOp[r.bone] : objectOp[r.object]);
    // The op a driver's written property feeds, and the op whose inputs a driver reads.
    const writesTo = (w) => {
      // A custom property does not change a pose: its readers depend on the writer (writersOf), the bone does not.
      if (w.kind === 'transform') return inputOp(w);
      // B-Bone values shape the bone's segments, which Follow B-Bone Shape targets read: order them before the bone.
      if (w.kind === 'poseValue' || w.kind === 'boneData') return boneOp[w.bone];
      if (w.kind === 'setting' || w.kind === 'armatureWeight') return w.constraint.members ? chainOp[w.constraint.index] : inputOp(w.constraint.owner);
      return -1;
    };
    const extra = ops.map(() => []);
    const writersOf = new Map();
    // Animation writes first: drivers and the ops reading a channel come after it.
    this.animations.forEach((a, i) => {
      for (const ch of a.channels) for (const { w } of ch.writes) {
        const t = writesTo(w);
        if (t >= 0) extra[t].push(animOp[i]);
        const key = sourceKey(w);
        if (key) writersOf.set(key, [...(writersOf.get(key) ?? []), animOp[i]]);
      }
    });
    this.drivers.forEach((d, i) => {
      const t = writesTo(d.write);
      if (t >= 0) extra[t].push(driverOp[i]);
      const key = sourceKey(d.write);
      extra[driverOp[i]].push(...(writersOf.get(key) ?? []).filter((op) => animOp.includes(op)));
      if (key) writersOf.set(key, [...(writersOf.get(key) ?? []), driverOp[i]]);
    });
    this.drivers.forEach((d, i) => {
      const deps = extra[driverOp[i]];
      for (const v of d.variables) {
        if (v.kind === 'read') deps.push(...(writersOf.get(sourceKey(v.r)) ?? []));
      if (v.kind === 'read' && v.r.kind === 'poseHead') deps.push(finalOf(v.r));
        if (v.kind === 'channel') deps.push(finalOf(v.r), objectOp[v.r.object]);
        if (v.kind === 'distance' || v.kind === 'angle') deps.push(finalOf(v.a), finalOf(v.b));
      }
    });
    ops.forEach((op, index) => {
      const deps = extra[index];
      if (op.kind === OP_OBJECT) {
        const o = this.objects[op.node];
        const pr = o.parent != null ? this.ref(o.parent, o.parent_type === 'BONE' ? o.parent_bone : null) : null;
        o.parentRef = pr;
        if (pr) deps.push(objectOp[pr.object], ...(pr.bone >= 0 ? [finalOf(pr)] : []));
        deps.push(...stackDeps(o.stack));
      } else if (op.kind === OP_BONE) {
        const b = this.bones[op.node], p = this.parent[op.node];
        deps.push(objectOp[b.arm]);
        if (p >= 0) deps.push(this.parentReadsPre(op.node) ? boneOp[p] : finalOf({ object: b.arm, bone: p }));
        deps.push(...stackDeps(b.stack));
      } else if (op.kind === OP_IK) {
        const c = this.chains[op.node];
        deps.push(objectOp[c.arm], finalOf(c.target), ...(c.pole ? [finalOf(c.pole)] : []));
        for (const x of c.members) deps.push(this.chainOf[x] === c.index ? boneOp[x] : finalOf({ object: c.arm, bone: x }));
      }
      op.deps = [...new Set(deps)].filter((d) => d !== index);
    });
    // Depth-first topological order; an edge back into a node being visited (a dependency cycle) is dropped, so
    // that op reads its input from the previous evaluation.
    const order = [], state = new Uint8Array(ops.length);
    this.cycles = [];
    const visit = (i) => {
      state[i] = 1;
      for (const d of ops[i].deps) {
        if (state[d] === 1) { this.cycles.push([i, d]); continue; }
        if (!state[d]) visit(d);
      }
      state[i] = 2;
      order.push(i);
    };
    // Bones are visited first, so in a cycle through an object parented to a bone (a bone tracking its own child
    // object) the dropped edge is the object's parent relation: the object reads the bone's earlier pose, as Blender
    // does (damped_track_aim2 look_parented_to_head_cycle: the object sits at the bone's rest).
    ops.forEach((op, i) => op.kind !== OP_OBJECT && !state[i] && visit(i));
    ops.forEach((_, i) => state[i] || visit(i));
    const position = new Int32Array(ops.length);
    order.forEach((i, k) => { position[i] = k; });
    this.ops = order.map((i) => ({ ...ops[i], deps: Int32Array.from(ops[i].deps.filter((d) => position[d] < position[i]).map((d) => position[d])) }));
    const at = (list) => Int32Array.from(list.map((i) => position[i]));
    this.objectOp = at(objectOp);
    this.boneOp = at(boneOp);
    this.chainOp = at(chainOp);
    this.driverOp = at(driverOp);
    this.animOp = at(animOp);
    // Drivers that read the frame (the `frame` name in an expression, or a Context Property).
    this.frameDriverOp = at(driverOp.filter((_, i) => {
      const d = this.drivers[i];
      return d.variables.some((v) => v.kind === 'context') || /\bframe\b/.test(d.expression?.source ?? '');
    }));
    // Drivers to rerun when an input is set: those that read it, and those that write it (a driven channel wins).
    this.driversOn = new Map();
    const on = (key, i) => { if (key) this.driversOn.set(key, [...(this.driversOn.get(key) ?? []), this.driverOp[i]]); };
    this.drivers.forEach((d, i) => {
      on(sourceKey(d.write), i);
      for (const v of d.variables) if (v.kind === 'read') on(sourceKey(v.r), i);
    });
  }

  // A bone of an IK chain whose parent is in the same chain builds on the parent's pre-solve pose.
  parentReadsPre(b) {
    const p = this.parent[b];
    return p >= 0 && this.chainOf[b] >= 0 && this.chainOf[b] === this.chainOf[p];
  }

  instance() {
    return new RigInstance(this);
  }

  // The frame of object `to` seen from object `from` (to^-1 @ from) in the description's own pose, for rest-time
  // decisions (Mirror merging and bisecting against a Mirror Object).
  restFrame(from, to) {
    if (!this.restInstance) { this.restInstance = this.instance(); this.restInstance.evaluate(); }
    return mul(invert(this.restInstance.worldView[to]), this.restInstance.worldView[from]);
  }
}

// Blender's default constraint name for a type: its words in title case (IK stays IK).
const defaultName = (type) => type.split('_').map((w) => (w === 'IK' ? w : w[0] + w.slice(1).toLowerCase())).join(' ');

// The input a driver reads or writes, as a key: a bone's or object's transform, or a custom property.
function sourceKey(r) {
  if (r.kind === 'transform') return r.bone >= 0 ? `b${r.bone}` : `o${r.object}`;
  if (r.kind === 'property') return `p${r.object}/${r.bone}/${r.name}`;
  return null;
}

export class RigInstance {
  constructor(program) {
    const P = this.program = program;
    const nO = P.objects.length, nB = P.bones.length;
    this.world = new Float64Array(nO * 16);
    this.parentMatrix = new Float64Array(nO * 16);
    this.objectBasis = new Float64Array(nO * 16);
    // Poses start at rest: what a dropped cycle edge reads on the first evaluation.
    this.pose = Float64Array.from(P.rest);
    this.pre = Float64Array.from(P.rest);
    // Transform inputs of pose bones and objects: location, rotation (4 values, see m4.js composeBasis), scale.
    this.location = new Float64Array(nB * 3);
    this.rotation = new Float64Array(nB * 4);
    this.scale = new Float64Array(nB * 3);
    this.rotationMode = new Uint8Array(nB);
    this.objLocation = new Float64Array(nO * 3);
    this.objRotation = new Float64Array(nO * 4);
    this.objScale = new Float64Array(nO * 3);
    this.objMode = new Uint8Array(nO);
    this.objMatrix = new Uint8Array(nO); // 1: the basis was set as a matrix
    this.properties = new Map();
    this.dirty = new Uint8Array(P.ops.length).fill(1);
    this.changed = new Uint8Array(P.ops.length);
    this.driverValue = new Float64Array(P.drivers.length).fill(NaN);
    this.frame = program.scene.frame_current ?? 1;
    this.lastRun = 0;
    this.tmp = new Float64Array(48);
    this.worldInv = new Float64Array(nO * 16);
    this.armIdentity = new Uint8Array(nO);
    this.stackIn = new Float64Array(16);
    // Custom properties' hard limits (`properties_ui`: { name: { min, max } }): animation and drivers write within them,
    // as Blender clamps an RNA write (CloudRig's parent switches are keyed past their last option).
    P.propertyRanges ??= new Map([
      ...P.objects.flatMap((o, i) => Object.entries(o.properties_ui ?? {}).map(([k, r]) => [`p${i}/-1/${k}`, r])),
      ...P.bones.flatMap((b) => Object.entries(b.pose.properties_ui ?? {}).map(([k, r]) => [`p${b.arm}/${b.index}/${k}`, r])),
    ]);
    P.objects.forEach((o, i) => {
      if (o.matrix_basis) this.setObjectBasis(i, o.matrix_basis);
      else this.setObjectTransform(i, o);
      for (const [k, v] of Object.entries(o.properties ?? {})) this.properties.set(`p${i}/-1/${k}`, v);
    });
    P.bones.forEach((b) => {
      this.setBonePose(b.index, b.pose);
      for (const [k, v] of Object.entries(b.pose.properties ?? {})) this.properties.set(`p${b.arm}/${b.index}/${k}`, v);
    });
    this.makeViews();
    this.runs = P.ops.map((op) => this.bindOp(op));
    this.dirty.fill(1);
  }

  // --- inputs ---

  setObjectBasis(i, m) {
    this.objectBasis.set(m, i * 16);
    this.objMatrix[i] = 1;
    this.dirty[this.program.objectOp[i]] = 1;
  }

  // Location, rotation and scale of an object from RNA-named values.
  setObjectTransform(i, p) {
    const mode = p.rotation_mode ?? ROT_NAMES[this.objMode[i]];
    if (p.location) this.objLocation.set(p.location, i * 3);
    if (p.scale) this.objScale.set(p.scale, i * 3);
    this.objMode[i] = rotationCode(mode);
    const rot = rotationValues({ ...this.program.objects[i], ...p, rotation_mode: mode });
    this.objRotation.set(rot, i * 4);
    this.objMatrix[i] = 0;
    this.touchObject(i);
  }

  // Location, rotation and scale of a pose bone from RNA-named values (rotation_mode, rotation_quaternion, ...).
  setBonePose(b, p) {
    if (this.useBasisMatrix) this.useBasisMatrix[b] = 0;
    if (p.location) this.location.set(p.location, b * 3);
    if (p.scale) this.scale.set(p.scale, b * 3);
    if (p.rotation_mode) this.rotationMode[b] = rotationCode(p.rotation_mode);
    this.rotation.set(rotationValues({ ...this.program.bones[b].pose, ...p, rotation_mode: ROT_NAMES[this.rotationMode[b]] }), b * 4);
    this.touchBone(b);
  }

  // A bone's basis as a matrix (column-major 4x4, relative to its rest in its parent's frame, as Blender's
  // matrix_basis), replacing its location, rotation and scale until setBonePose is called for it.
  setBoneBasis(b, m) {
    (this.basisMatrix ??= new Float64Array(this.program.bones.length * 16)).set(m, b * 16);
    (this.useBasisMatrix ??= new Uint8Array(this.program.bones.length))[b] = 1;
    this.touchBone(b);
  }

  // Many bases at once: `matrices` holds 16 numbers per bone (all bones, in bone order); only `touched` (bone
  // indices) are taken.
  setBasisArray(matrices, touched) {
    const store = this.basisMatrix ??= new Float64Array(this.program.bones.length * 16);
    const use = this.useBasisMatrix ??= new Uint8Array(this.program.bones.length);
    for (let k = 0; k < touched.length; k++) {
      const b = touched[k];
      for (let i = 0; i < 16; i++) store[b * 16 + i] = matrices[b * 16 + i];
      use[b] = 1;
      this.touchBone(b);
    }
  }

  // Bone indices whose pose the last evaluate() may have changed (a view, valid until the next evaluate).
  changedBoneIndices() {
    return this.changedBones ? this.changedBones.subarray(0, this.changedBoneCount) : new Int32Array(0);
  }

  // Bone indices whose local pose (the pose relative to the parent bone's pose; armature space for a root bone)
  // changed since the previous call, a view valid until the next call; localPoseView[b] holds those local matrices.
  // Bones that moved only with their parent are not listed (changes under 1e-9 are ignored). The first call lists
  // every bone.
  changedLocalPoses() {
    const P = this.program, n = P.bones.length;
    if (!this.localPose) {
      this.localPose = new Float64Array(n * 16).fill(NaN);
      this.localPoseView = P.bones.map((_, b) => this.localPose.subarray(b * 16, b * 16 + 16));
      this.localPending = new Uint8Array(n).fill(1);
      this.localChanged = new Int32Array(n);
    }
    const L = this.localPose, T = LOCAL_TMP, pending = this.localPending;
    let count = 0;
    for (let b = 0; b < n; b++) {
      if (!pending[b]) continue;
      pending[b] = 0;
      const p = P.parent[b];
      if (p >= 0) { invertAffine(T, 0, this.pose, p * 16); mulAffine(T, 0, T, 0, this.pose, b * 16); }
      else for (let i = 0; i < 16; i++) T[i] = this.pose[b * 16 + i];
      // Recomputing a local pose under a moved parent rounds in the last bits: such a bone did not change.
      let same = true;
      for (let i = 0; i < 16; i++) if (!(Math.abs(T[i] - L[b * 16 + i]) <= LOCAL_EPS)) { same = false; break; }
      if (same) continue;
      L.set(T, b * 16);
      this.localChanged[count++] = b;
    }
    return this.localChanged.subarray(0, count);
  }

  // A B-Bone's segment joints after the last evaluate() (bone space, (n + 1) x 16 floats; rest: the rest shape),
  // the same arrays the deformers use, computed once per evaluate.
  bboneSegments(b, rest = false) {
    return bboneSegments(this, b, rest);
  }

  // After writing location, rotation or scale arrays directly.
  touchBone(b) {
    this.dirty[this.program.boneOp[b]] = 1;
    this.touchDrivers(`b${b}`);
  }

  touchObject(i) {
    if (this.program.objectOp) this.dirty[this.program.objectOp[i]] = 1;
    this.touchDrivers(`o${i}`);
  }

  touchDrivers(key) {
    const list = this.program.driversOn?.get(key);
    if (list) for (const op of list) this.dirty[op] = 1;
  }

  touchAll() {
    this.dirty.fill(1);
  }

  // --- by name, for page code ---

  objectIndexOf(name) {
    const i = this.program.objectIndex.get(name);
    if (i === undefined) throw new Error(`no object ${name}`);
    return i;
  }

  boneIndexOf(objectName, boneName) {
    const b = this.program.objects[this.objectIndexOf(objectName)].boneIndex?.get(boneName);
    if (b === undefined) throw new Error(`no bone ${objectName}:${boneName}`);
    return b;
  }

  // Sets a property by its RNA path on an object, as drivers and actions address it: 'location' with an index,
  // 'pose.bones["B"].rotation_quaternion', '["prop"]', 'pose.bones["B"]["prop"]', 'pose.bones["B"].constraints["C"].influence'.
  setPath(objectName, path, value, index = 0) {
    const w = resolveProperty(this.program, objectName, 'OBJECT', parsePath(path), index);
    if (!w) throw new Error(`path not supported: ${objectName}.${path}`);
    this.writeProperty(w, value);
    if (w.kind === 'transform') (w.bone >= 0 ? this.touchBone(w.bone) : this.touchObject(w.object));
    else if (w.kind === 'property') this.touchDrivers(`p${w.object}/${w.bone}/${w.name}`);
    if (w.kind === 'setting' || w.kind === 'armatureWeight' || w.kind === 'property') this.touchAll();
  }

  // Shape key values and Absolute eval_time per mesh object (overriding the description's).
  setShapeKeyValue(objectName, keyName, value) {
    (this.shapeValues ??= new Map()).set(`${this.objectIndexOf(objectName)}/${keyName}`, value);
  }
  shapeKeyValue(mesh, name) { return this.shapeValues?.get(`${mesh}/${name}`); }
  setShapeKeyEvalTime(objectName, t) { (this.evalTimes ??= new Map()).set(this.objectIndexOf(objectName), t); }
  shapeKeyEvalTime(mesh) { return this.evalTimes?.get(mesh); }

  // A lattice's points this frame (lattice space): deformed by its own modifier stack when it has one.
  latticePoints(index) {
    const ob = this.program.objects[index];
    if (!ob.modifiers?.length) return null;
    const deform = (this.latticeDeforms ??= new Map()).get(index) ?? compileDeform(this.program, index);
    this.latticeDeforms.set(index, deform);
    const p = deformMesh(this, deform);
    return Array.from({ length: p.length / 3 }, (_, i) => [p[i * 3], p[i * 3 + 1], p[i * 3 + 2]]);
  }

  // A custom property of an object (bone -1) or pose bone.
  property(object, bone, name) {
    return this.properties.get(`p${object}/${bone}/${name}`);
  }

  setProperty(object, bone, name, value) {
    const key = `p${object}/${bone}/${name}`;
    this.properties.set(key, value);
    this.touchDrivers(key);
    const P = this.program;
    if (P.objectOp) this.dirty[bone >= 0 ? P.boneOp[bone] : P.objectOp[object]] = 1;
  }

  // One value of location, rotation_* or scale of a bone or object (a rotation property not in use reads 0).
  transformValue(object, bone, prop, index) {
    const [loc, rot, scale, mode, k] = bone >= 0
      ? [this.location, this.rotation, this.scale, this.rotationMode[bone], bone]
      : [this.objLocation, this.objRotation, this.objScale, this.objMode[object], object];
    if (prop === 'location') return loc[k * 3 + index];
    if (prop === 'scale') return scale[k * 3 + index];
    return ROTATION_PROPS[prop].includes(mode) ? rot[k * 4 + index] : 0;
  }

  setTransformValue(object, bone, prop, index, value) {
    const [loc, rot, scale, mode, k] = bone >= 0
      ? [this.location, this.rotation, this.scale, this.rotationMode[bone], bone]
      : [this.objLocation, this.objRotation, this.objScale, this.objMode[object], object];
    if (prop === 'location') loc[k * 3 + index] = value;
    else if (prop === 'scale') scale[k * 3 + index] = value;
    else if (ROTATION_PROPS[prop].includes(mode)) rot[k * 4 + index] = value;
  }

  boneBasis(b) {
    const out = new Float64Array(16);
    if (this.useBasisMatrix?.[b]) return out.fill(0).map((_, i) => this.basisMatrix[b * 16 + i]);
    composeBasis(out, 0, this.location, b * 3, this.rotation, b * 4, this.rotationMode[b], this.scale, b * 3);
    return out;
  }

  objectBasisView(i) {
    this.composeObject(i);
    return this.objectBasis.subarray(i * 16, i * 16 + 16);
  }

  objectRotationMode(i) { return this.objMode[i]; }
  objectRotation(i) { return Array.from(this.objRotation.subarray(i * 4, i * 4 + 3)); }
  objectLocation(i) { return Array.from(this.objLocation.subarray(i * 3, i * 3 + 3)); }

  composeObject(i) {
    if (!this.objMatrix[i]) composeBasis(this.objectBasis, i * 16, this.objLocation, i * 3, this.objRotation, i * 4, this.objMode[i], this.objScale, i * 3);
  }

  // --- views and entities (the space conversions of src/spaces.js read these) ---

  makeViews() {
    const P = this.program;
    const view = (a, i) => a.subarray(i * 16, i * 16 + 16);
    this.worldView = P.objects.map((_, i) => view(this.world, i));
    this.poseView = P.bones.map((_, i) => view(this.pose, i));
    this.preView = P.bones.map((_, i) => view(this.pre, i));
    this.restView = P.bones.map((_, i) => view(P.rest, i));
    this.objectEnt = P.objects.map((o, i) => ({ kind: 'object', parentMatrix: o.parentRef ? view(this.parentMatrix, i) : null }));
    const boneEnt = (b, parentPose) => {
      const p = P.parent[b.index];
      return {
        kind: 'bone', armatureWorld: this.worldView[b.arm], armatureInv: view(this.worldInv, b.arm), offset: view(P.offset, b.index),
        rest: this.restView[b.index], flags: b.flags, length: b.length,
        parent: p >= 0 ? { pose: parentPose(p), rest: this.restView[p] } : null,
      };
    };
    this.targetEnt = P.bones.map((b) => boneEnt(b, (p) => this.poseView[p]));
    // A target bone: its rest and, for a B-Bone, its segment joints now (pose) and at rest (Armature constraint).
    this.boneRec = P.bones.map((b) => ({
      rest: this.restView[b.index], bone: b,
      segments: (b.bbone_segments ?? 1) > 1 ? (rest) => bboneSegments(this, b.index, rest) : null,
    }));
    this.ownerEnt = P.bones.map((b) => (P.parentReadsPre(b.index) ? boneEnt(b, (p) => this.preView[p]) : this.targetEnt[b.index]));
  }

  // World matrix of a reference (a bone's moved to head_tail along it), with the entity spaces need. A bone's world
  // is written into `out` (fresh when not given); `rec` is reused when given.
  target(r, headTail = 0, out = new Float64Array(16), rec = {}, bboneShape = false) {
    rec.object = this.program.objects[r.object];
    if (r.bone < 0) {
      rec.world = this.worldView[r.object]; rec.ent = this.objectEnt[r.object]; rec.bone = null;
      return rec;
    }
    const P = this.program, p = this.pose, o = r.bone * 16, t = this.tmp;
    for (let i = 0; i < 16; i++) t[32 + i] = p[o + i];
    if (headTail && bboneShape && (P.bones[r.bone].bbone_segments ?? 1) > 1) this.bboneShapeTarget(r.bone, headTail, t);
    else if (headTail) {
      const l = P.length[r.bone] * headTail;
      t[44] += t[36] * l; t[45] += t[37] * l; t[46] += t[38] * l;
    }
    if (this.armIdentity[r.object]) out.set(t.subarray(32, 48));
    else mulAffine(out, 0, this.world, r.object * 16, t, 32);
    rec.world = out; rec.ent = this.targetEnt[r.bone]; rec.bone = this.boneRec[r.bone];
    return rec;
  }

  // Follow B-Bone Shape: the pose times the segment joint at head_tail (joints blended linearly between). Exact at
  // the joints (head_tail = k / segments); between them an approximation.
  bboneShapeTarget(b, headTail, t) {
    const bone = this.program.bones[b], n = bone.bbone_segments, J = bboneJoints(bone, bboneContext(this), false);
    const x = Math.min(n, Math.max(0, headTail * n)), k = Math.min(Math.floor(x), n - 1), f = x - k;
    const M = new Float64Array(16);
    for (let i = 0; i < 16; i++) M[i] = J[k * 16 + i] * (1 - f) + J[(k + 1) * 16 + i] * f;
    const out = mul(t.subarray(32, 48), M);
    for (let i = 0; i < 16; i++) t[32 + i] = out[i];
  }

  // --- evaluation ---

  bindOp(op) {
    if (op.kind === OP_OBJECT) return () => this.runObject(op.node);
    if (op.kind === OP_BONE) return () => this.runBone(op.node);
    if (op.kind === OP_IK) return () => this.runChain(op.node);
    if (op.kind === OP_ANIM) return () => this.runAnimation(op.node);
    return () => this.runDriver(op.node);
  }

  // Runs every op whose inputs changed since the last evaluation. Returns the number of ops run. An op that reports
  // no change (a driver whose value stayed) does not wake its dependents.
  evaluate() {
    const { ops } = this.program, dirty = this.dirty, changed = this.changed, runs = this.runs;
    this.pass = (this.pass ?? 0) + 1;
    this.evaluating = true;
    let count = 0;
    for (let i = 0; i < ops.length; i++) {
      let need = dirty[i];
      if (!need) {
        const deps = ops[i].deps;
        for (let k = 0; k < deps.length; k++) if (changed[deps[k]]) { need = 1; break; }
      }
      changed[i] = 0;
      if (need) { changed[i] = runs[i]() === false ? 0 : 1; dirty[i] = 0; count++; }
    }
    this.evaluating = false;
    this.lastRun = count;
    // The bones whose final pose this evaluation may have changed (their op or their IK chain ran).
    const P = this.program;
    let n = 0;
    const list = this.changedBones = this.changedBoneBuffer ??= new Int32Array(P.bones.length);
    for (let b = 0; b < P.bones.length; b++) {
      const c = P.chainOf[b];
      if (changed[P.boneOp[b]] || (c >= 0 && changed[P.chainOp[c]])) list[n++] = b;
    }
    this.changedBoneCount = n;
    const lastChanged = (this.boneChangedPass ??= new Int32Array(P.bones.length).fill(this.pass));
    for (let k = 0; k < n; k++) lastChanged[list[k]] = this.pass;
    if (this.localPending) for (let k = 0; k < n; k++) this.localPending[list[k]] = 1;
    return count;
  }

  runDriver(i) {
    if (this.fkOnly) return false; // level of detail: drivers keep their last values
    const d = this.program.drivers[i];
    const value = evaluateDriver(this, d, this.frame);
    if (value === null) return false;
    // Always written (animation may have written the property this frame); dependents wake only on a change.
    this.writeProperty(d.write, value);
    const changed = value !== this.driverValue[i];
    this.driverValue[i] = value;
    return changed;
  }

  // The animation stage of one object at this.frame.
  // The animation stage of one object at this.frame. Only channels whose value changed wake their readers (the op
  // reports no change of its own), so a still part of the rig stays still; constant channels are written once.
  runAnimation(i) {
    const first = !(this.animRan ??= new Uint8Array(this.program.animations.length))[i];
    this.animRan[i] = 1;
    for (const { w, value } of evaluateAnimation(this.program.animations[i], this.frame, first)) {
      if (!first && this.readWritten(w) === value) continue;
      this.writeProperty(w, value);
      this.wake(w);
    }
    return false;
  }

  // The current value of an animated property, and the ops to rerun when it changes.
  readWritten(w) {
    if (w.kind === 'transform') return this.transformValue(w.object, w.bone, w.prop, w.index);
    if (w.kind === 'setting') { const v = w.constraint.s[w.prop]; return Array.isArray(v) ? v[w.index ?? 0] : v; }
    if (w.kind === 'property') return this.properties.get(`p${w.object}/${w.bone}/${w.name}`);
    return undefined;
  }

  wake(w) {
    const P = this.program;
    if (w.kind === 'transform') { if (w.bone >= 0) this.touchBone(w.bone); else this.touchObject(w.object); }
    else if (w.kind === 'property') this.touchDrivers(`p${w.object}/${w.bone}/${w.name}`);
    else if (w.kind === 'setting' || w.kind === 'armatureWeight') {
      const c = w.constraint;
      this.dirty[c.members ? P.chainOp[c.index] : c.owner.bone >= 0 ? P.boneOp[c.owner.bone] : P.objectOp[c.owner.object]] = 1;
    } else this.touchAll();
  }

  // Sets the current frame: animation and the drivers that may read it rerun.
  setFrame(frame) {
    if (frame === this.frame) return;
    this.frame = frame;
    for (const op of this.program.animOp) this.dirty[op] = 1;
    for (const op of this.program.frameDriverOp) this.dirty[op] = 1;
  }

  writeProperty(w, value) {
    switch (w.kind) {
      case 'transform': this.setTransformValue(w.object, w.bone, w.prop, w.index, value); break;
      case 'property': {
        const key = sourceKey(w), r = this.program.propertyRanges.get(key);
        this.properties.set(key, r ? Math.min(r.max ?? Infinity, Math.max(r.min ?? -Infinity, value)) : value);
        break;
      }
      case 'setting': {
        // Any constraint setting: booleans by value != 0, arrays by component, numbers as they are.
        const s = w.constraint.s, cur = s[w.prop];
        if (typeof cur === 'boolean') s[w.prop] = value !== 0;
        // Settings with a 0..1 range in Blender's RNA: a driver writing past it is clamped (Action eval_time: Snow's
        // eyebrow drivers reach 1.33).
        else if (w.prop === 'influence' || w.prop === 'eval_time') s[w.prop] = Math.min(1, Math.max(0, value));
        else if (Array.isArray(cur)) { s[w.prop] = cur.slice(); s[w.prop][w.index ?? 0] = value; }
        else s[w.prop] = value;
        break;
      }
      // Properties with a range store the value clamped to it (a target weight is 0..1).
      case 'armatureWeight': if (w.constraint.targetList[w.index]) w.constraint.targetList[w.index].weight = Math.min(1, Math.max(0, value)); break;
      case 'boneData': (this.boneData ??= new Map()).set(`${w.bone}/${w.prop}`, value); this.bboneValuesVersion = (this.bboneValuesVersion ?? 0) + 1; break;
      case 'poseValue': {
        this.bboneValuesVersion = (this.bboneValuesVersion ?? 0) + 1;
        const cur = this.poseValues?.get(`${w.bone}/${w.prop}`) ?? this.program.bones[w.bone].pose[w.prop];
        let v = value;
        if (Array.isArray(cur)) { v = cur.slice(); v[w.index ?? 0] = value; }
        (this.poseValues ??= new Map()).set(`${w.bone}/${w.prop}`, v);
        break;
      }
      case 'shapeKey': (this.shapeValues ??= new Map()).set(`${w.object}/${w.name}`, value); break;
      case 'modifier': (this.modifierValues ??= new Map()).set(`${w.object}/${w.modifier}/${w.prop}`, value); break;
      case 'shapeEvalTime': (this.evalTimes ??= new Map()).set(w.object, value); break;
    }
  }

  runObject(i) {
    const P = this.program, o = P.objects[i], out = this.worldView[i], pr = o.parentRef;
    this.composeObject(i);
    let w0;
    if (pr) {
      let pw = this.worldView[pr.object];
      if (pr.bone >= 0) pw = mul(mul(pw, this.poseView[pr.bone]), translationMatrix([0, P.length[pr.bone], 0]));
      const pm = o.matrix_parent_inverse ? mul(pw, o.matrix_parent_inverse) : pw;
      this.parentMatrix.set(pm, i * 16);
      w0 = mul(pm, this.objectBasis.subarray(i * 16, i * 16 + 16));
    } else w0 = this.objectBasis.slice(i * 16, i * 16 + 16);
    out.set(o.stack.length ? this.runStack(o.stack, w0, this.objectEnt[i], ROT_NAMES[this.objMode[i]]) : w0);
    if (o.bones) {
      this.armIdentity[i] = isIdentity(this.world, i * 16) ? 1 : 0;
      invertAffine(this.worldInv, i * 16, this.world, i * 16);
    }
  }

  runBone(b) {
    const P = this.program, b16 = b * 16, p = P.parent[b], t = this.tmp;
    const toPre = P.chainOf[b] >= 0;
    const out = toPre ? this.pre : this.pose;
    if (this.useBasisMatrix?.[b]) for (let i = 0; i < 16; i++) t[i] = this.basisMatrix[b16 + i];
    else composeBasis(t, 0, this.location, b * 3, this.rotation, b * 4, this.rotationMode[b], this.scale, b * 3);
    if (p < 0) mulAffine(out, b16, P.rest, b16, t, 0);
    else {
      const parentPose = P.parentReadsPre(b) ? this.pre : this.pose;
      if (P.fast[b]) {
        if (P.connect[b]) t[12] = t[13] = t[14] = 0;
        mulAffine(t, 16, P.offset, b16, t, 0);
        mulAffine(out, b16, parentPose, p * 16, t, 16);
      } else {
        poseFromBasisInto(out, b16, parentPose, p * 16, P.rest, p * 16, P.offset, b16, P.bones[b].flags, t, 0, P.connect[b]);
      }
    }
    const stack = P.bones[b].stack;
    if (!stack.length) return;
    const a = P.bones[b].arm, a16 = a * 16, w = this.stackIn, ident = this.armIdentity[a];
    if (ident) for (let i = 0; i < 16; i++) w[i] = out[b16 + i];
    else mulAffine(w, 0, this.world, a16, out, b16);
    const hx = out[b16 + 12], hy = out[b16 + 13], hz = out[b16 + 14];
    const result = this.runStack(stack, w, this.ownerEnt[b], ROT_NAMES[this.rotationMode[b]]);
    if (ident) for (let i = 0; i < 16; i++) out[b16 + i] = result[i];
    else mulAffine(out, b16, this.worldInv, a16, result, 0);
    if (P.connect[b] && p >= 0) { out[b16 + 12] = hx; out[b16 + 13] = hy; out[b16 + 14] = hz; }
  }

  // A bone's stack stays in a bone space (LOCAL, POSE, LOCAL_WITH_PARENT) between constraints of that same space at
  // full influence: converting to world and back would be the identity. Influence blends happen in world.
  runStack(stack, w, ent, rotationMode) {
    let local = null, localSpace = null;
    for (const e of stack) {
      const s = e.s;
      if (!e.valid || s.enabled === false || s.mute) continue;
      const influence = s.influence ?? 1;
      if (influence <= 0) continue;
      const space = s.owner_space ?? 'WORLD';
      const stay = ent.kind === 'bone' && influence >= 1 && BONE_SPACES.has(space) && !e.type.resultInWorld && e.type.type !== 'ARMATURE';
      if (local && !(stay && space === localSpace)) { w = fromSpace(localSpace, local, ent, {}); local = null; }
      if (stay) {
        const out = runConstraint(this, e, w, ent, rotationMode, local, true);
        if (out) { local = out; localSpace = space; }
        continue;
      }
      const out = runConstraint(this, e, w, ent, rotationMode);
      if (out) w = influence >= 1 ? out : blendMatrices(w, out, influence);
    }
    return local ? fromSpace(localSpace, local, ent, {}) : w;
  }

  runChain(ci) {
    const P = this.program, c = P.chains[ci], s = c.s;
    const startOf = (x) => (P.chainOf[x] === ci ? this.preView[x] : Float64Array.from(this.poseView[x]));
    const start = c.members.map(startOf);
    // Level of detail: an FK-only character skips IK and Spline IK (chains keep their FK pose).
    if (this.fkOnly || s.enabled === false || s.mute || (s.influence ?? 1) <= 0) {
      c.members.forEach((x, k) => this.poseView[x].set(start[k]));
      return;
    }
    const toPose = invert(this.worldView[c.arm]);
    const t = this.target(c.target, s.head_tail ?? 0);
    const tm = mul(toPose, t.world);
    let result;
    if (c.type.solveCurve) {
      result = c.type.solveCurve(c.members.map((x, k) => ({ pose: start[k], length: P.length[x] })), { curve: t.object.data }, tm, s);
    } else {
      const pole = c.pole ? translation(mul(toPose, this.target(c.pole).world)) : null;
      // Each joint's rest frame relative to the chain (its parent's frame for IK locks): the rest offset, for the chain
      // root carried by its parent's final pose.
      const frameOf = (x, k) => {
        const o = P.offset.subarray(x * 16, x * 16 + 16), p = P.parent[x];
        return k || p < 0 ? o : mul(this.poseView[p], o);
      };
      const chain = c.members.map((x, k) => ({ pose: start[k], length: P.length[x], ik: P.bones[x].pose, frame: frameOf(x, k) }));
      result = c.type.solveChain(chain, translation(tm), pole, s, tm);
    }
    c.members.forEach((x, k) => this.poseView[x].set(result[k]));
  }
}

const LOCAL_TMP = new Float64Array(16), LOCAL_EPS = 1e-9;
