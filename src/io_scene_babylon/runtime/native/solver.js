// @ts-nocheck
// SPDX-License-Identifier: MIT OR Apache-2.0
// From babylon-blender-rig (scripts/native-rig.mjs).
import { mat, mul, invert, clone, translation, setTranslation, transformPoint, lerpV, translationMatrix } from './math.js';
import { toSpace, fromSpace, localOwnerOrient } from './spaces.js';
import { blendMatrices } from './blend.js';
import { DEFAULT_FLAGS, poseFromBasis } from './bone.js';
import { constraintTypes } from './constraints/index.js';

// Evaluates objects and armature bones with their constraint stacks, in Blender's order (00-foundations).
// Matrices are column-major Float64Array(16), column vectors (see math.js).
//
// Objects:  solver.addObject(name, { parent, parentBone, parentInverse, basis, constraints, bones })
// Bones:    { name, parent, rest, length, flags, basis, constraints } (rest and pose in armature space)
// Constraints are plain settings objects named as in Blender's Python API:
//   { type: 'COPY_ROTATION', target: 'Obj', subtarget: 'Bone', owner_space, target_space, influence, ... }
export class ConstraintSolver {
  constructor({ types = constraintTypes } = {}) {
    this.types = types;
    this.objects = new Map();
    this.frame = 0;
  }

  addObject(name, desc = {}) {
    const ob = {
      name, parent: null, parentBone: null, parentInverse: null, basis: mat(), constraints: [], ...desc,
      world: mat(), _frame: -1, _busy: false,
    };
    if (desc.bones) this.setBones(ob, desc.bones);
    this.objects.set(name, ob);
    return ob;
  }

  setBones(ob, bones) {
    ob.bones = new Map();
    for (const b of bones) {
      ob.bones.set(b.name, {
        parent: null, basis: mat(), constraints: [], length: 1, ...b,
        flags: { ...DEFAULT_FLAGS, ...b.flags }, pose: clone(b.rest), _frame: -1, _busy: false,
      });
    }
  }

  evaluate() {
    this.frame++;
    for (const ob of this.objects.values()) {
      this.objectWorld(ob);
      if (ob.bones) for (const b of ob.bones.values()) this.bonePose(ob, b);
    }
  }

  // --- objects ---

  objectWorld(ob) {
    if (ob._frame === this.frame || ob._busy) return ob.world;
    ob._busy = true;
    const parentMatrix = this.parentMatrix(ob);
    const w0 = parentMatrix ? mul(parentMatrix, ob.basis) : clone(ob.basis);
    const ent = { kind: 'object', parentMatrix };
    ob.world = this.runStack(ob.constraints, w0, ent, { object: ob });
    ob._frame = this.frame;
    ob._busy = false;
    return ob.world;
  }

  parentMatrix(ob) {
    if (!ob.parent) return null;
    const parent = this.objects.get(ob.parent);
    if (!parent) return null;
    let pw = this.objectWorld(parent);
    if (ob.parentBone && parent.bones?.has(ob.parentBone)) {
      const b = parent.bones.get(ob.parentBone);
      pw = mul(mul(pw, this.bonePose(parent, b)), translationMatrix([0, b.length, 0]));
    }
    return ob.parentInverse ? mul(pw, ob.parentInverse) : pw;
  }

  // --- bones ---

  boneParent(arm, b) {
    const p = b.parent && arm.bones.get(b.parent);
    return p ? { pose: this.bonePose(arm, p), rest: p.rest } : null;
  }

  boneEntity(arm, b) {
    return { kind: 'bone', armatureWorld: this.objectWorld(arm), rest: b.rest, parent: this.boneParent(arm, b), flags: b.flags, length: b.length };
  }

  bonePose(arm, b) {
    if (b._frame === this.frame || b._busy) return b.pose;
    const chain = this.ikChainOf(arm, b);
    if (chain) {
      this.solveIK(arm, chain);
      return b.pose;
    }
    b._busy = true;
    b.pose = this.fkPose(arm, b, this.boneParent(arm, b));
    b._frame = this.frame;
    b._busy = false;
    return b.pose;
  }

  // The bone's pose from its parent and basis, then its constraint stack (IK excluded).
  fkPose(arm, b, parent) {
    const armatureWorld = this.objectWorld(arm);
    const ent = { kind: 'bone', armatureWorld, rest: b.rest, parent, flags: b.flags, length: b.length };
    const pose0 = poseFromBasis(parent, b.rest, b.flags, b.basis);
    if (!b.constraints.length) return pose0;
    const w = this.runStack(b.constraints, mul(armatureWorld, pose0), ent, { object: arm, bone: b });
    const pose = mul(invert(armatureWorld), w);
    if (b.flags.use_connect && parent) setTranslation(pose, translation(pose0));
    return pose;
  }

  // --- IK (runs after the chain bones' other constraints, specs/ik.md) ---

  ikChains(arm) {
    if (arm._ikFrame === this.frame) return arm._ikChains;
    const chains = new Map();
    for (const b of arm.bones.values()) {
      for (const c of b.constraints) {
        const type = this.types[c.type];
        if (type?.targets !== 'chain' || c.enabled === false || c.mute || (c.influence ?? 1) <= 0) continue;
        if (!this.objects.has(c.target) || (c.subtarget && !this.objects.get(c.target).bones?.has(c.subtarget))) continue;
        const bones = [];
        const count = c.chain_count ?? type.defaults.chain_count;
        for (let x = b; x && (!count || bones.length < count); x = x.parent && arm.bones.get(x.parent)) bones.unshift(x);
        const chain = { owner: b, c, type, bones };
        for (const x of bones) if (!chains.has(x)) chains.set(x, chain);
      }
    }
    arm._ikFrame = this.frame;
    arm._ikChains = chains;
    return chains;
  }

  ikChainOf(arm, b) {
    return this.ikChains(arm).get(b) ?? null;
  }

  solveIK(arm, chain) {
    const { bones, c, type } = chain;
    for (const b of bones) b._busy = true;
    const rootParent = this.boneParent(arm, bones[0]);
    const poses = [];
    bones.forEach((b, i) => poses.push(this.fkPose(arm, b, i ? { pose: poses[i - 1], rest: bones[i - 1].rest } : rootParent)));
    const toPose = invert(this.objectWorld(arm));
    const t = this.target(c.target, c.subtarget, c.head_tail ?? 0);
    const pole = c.pole_target ? this.target(c.pole_target, c.pole_subtarget) : null;
    const settings = { ...type.defaults, ...c };
    const result = t && type.solveCurve ? type.solveCurve(bones.map((b, i) => ({ pose: poses[i], length: b.length })), t.object, mul(toPose, t.world), settings)
      : t ? type.solveChain(
      bones.map((b, i) => ({ pose: poses[i], length: b.length, ik: b.ik ?? {} })),
      translation(mul(toPose, t.world)), pole ? translation(mul(toPose, pole.world)) : null, settings, mul(toPose, t.world),
    ) : poses;
    bones.forEach((b, i) => { b.pose = result[i]; b._frame = this.frame; b._busy = false; });
  }

  // --- targets ---

  // World matrix and space entity of a target, or null when it is missing.
  target(name, subtarget, headTail = 0) {
    const ob = name && this.objects.get(name);
    if (!ob) return null;
    if (!subtarget) return { world: this.objectWorld(ob), ent: { kind: 'object', parentMatrix: this.parentMatrix(ob) }, object: ob };
    const b = ob.bones?.get(subtarget);
    if (!b) return null;
    const pose = clone(this.bonePose(ob, b));
    if (headTail) setTranslation(pose, lerpV(translation(pose), transformPoint(pose, [0, b.length, 0]), headTail));
    const ent = this.boneEntity(ob, b);
    return { world: mul(ent.armatureWorld, pose), ent, object: ob, bone: b };
  }

  customMatrix(c) {
    const t = this.target(c.space_object, c.space_subtarget);
    return t?.world;
  }

  targetInSpace(t, space, c, ownerEnt) {
    if (space === 'LOCAL_OWNER_ORIENT') {
      if (t.ent.kind !== 'bone' || ownerEnt.kind !== 'bone') return toSpace('WORLD', t.world, t.ent);
      return localOwnerOrient(toSpace('LOCAL', t.world, t.ent), t.ent.rest, ownerEnt.rest);
    }
    return toSpace(space, t.world, t.ent, { custom: space === 'CUSTOM' ? this.customMatrix(c) : null, w0: t.world });
  }

  // --- the stack ---

  runStack(constraints, w, ent, owner) {
    for (const c of constraints) {
      if (c.enabled === false || c.mute) continue;
      const influence = c.influence ?? 1;
      if (influence <= 0) continue;
      const type = this.types[c.type];
      if (!type || type.targets === 'chain') continue;
      const out = this.evaluateOne(type, c, w, ent, owner);
      if (out) w = blendMatrices(w, out, influence);
    }
    return w;
  }

  evaluateOne(type, c, w0, ent, owner) {
    const ownerSpace = c.owner_space ?? 'WORLD', targetSpace = c.target_space ?? 'WORLD';
    const custom = ownerSpace === 'CUSTOM' || targetSpace === 'CUSTOM' ? this.customMatrix(c) : null;
    let target = null;
    if (type.targets === 'multi') {
      target = (c.targets ?? []).map((t) => ({ ...t, ...this.target(t.target, t.subtarget) })).filter((t) => t.world);
    } else if (type.targets !== 'none') {
      const t = this.target(c.target, c.subtarget, c.head_tail ?? 0);
      if (!t) { if (type.targets !== 'optional') return null; }
      else target = this.targetInSpace(t, targetSpace, c, ent);
    }
    const spaces = {
      solver: this, owner, ent, ownerSpace, targetSpace, custom, w0,
      rotationMode: (owner.bone ?? owner.object).rotationMode ?? 'XYZ',
      // Values Blender writes back onto the constraint (stretch_to rest_length).
      store: (key, value) => { c[key] = value; },
      toOwner: (w) => toSpace(ownerSpace, w, ent, { custom, w0 }),
      fromOwner: (x) => fromSpace(ownerSpace, x, ent, { custom, w0 }),
    };
    const local = spaces.toOwner(w0);
    const result = type.evaluate(local, target, { ...type.defaults, ...c }, spaces);
    if (!result) return null;
    return type.resultInWorld ? result : spaces.fromOwner(result);
  }
}

