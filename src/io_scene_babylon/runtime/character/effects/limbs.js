// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// A limb as limb effects move it (the guide's rule): the rig's IK control when the limb is in IK, else a two-bone solve
// on the played bones with the rig's limits. All of it is read once from the rig's own constraints in the IR:
// - a chain bone that copies two others (Copy Transforms FK and IK, as Rigify and CloudRig make limbs) plays the one
//   outside any IK chain, and the influence of the other copy is the limb's IK weight;
// - a chain bone with an IK constraint of its own is in IK by that constraint's influence;
// - the IK control is that IK constraint's target;
// - the hinge's limits are the played bone's IK locks and limits, else the IK chain's, else a bend of up to 150 degrees.
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core';
import { createPoseApi } from '../pose-api.js';
import { dataAt } from '../../ir.js';
import { about, between, moveWorld, turnWorld, worldOf } from './space.js';

const ROOT = Matrix.Identity();
/** @typedef {import('../api.js').Pose} Pose @typedef {import('../api.js').Bone} Bone */

const BEND = 150 * Math.PI / 180;
const quoted = (/** @type {string} */ s) => JSON.stringify(s);

/** The armature's pose bones in the IR, by name, with their constraints (none without an IR: a rig made in code). */
export function poseBones(/** @type {any} */ character) {
  if (!read.has(character)) read.set(character, readPoseBones(character));
  return /** @type {Map<string, any>} */ (read.get(character));
}
const read = new WeakMap();

function readPoseBones(/** @type {any} */ character) {
  const ir = character.blend?.ir, id = `OB:${character.armature}`, items = ir?.ids?.[id]?.data?.pose?.bones ?? [];
  // The IR writes a struct once and refers to it elsewhere; most refer into another pose bone, found here by name.
  const inline = new Map(items.filter((/** @type {any} */ b) => typeof b.struct !== 'string').map((/** @type {any} */ b) => [b.name, b]));
  const resolve = (/** @type {any} */ v) => {
    if (typeof v?.struct !== 'string' || (v.id && v.id !== id)) return v;
    const [, name, rest] = v.struct.match(/^pose\.bones\["((?:[^"\\]|\\.)*)"\](.*)$/) ?? [];
    if (name === undefined) return dataAt(ir, [id, v.struct]);
    let value = inline.get(name.replace(/\\(.)/g, '$1'));
    for (const [, key, index] of rest.matchAll(/\.(\w+)|\[(\d+)\]/g)) value = resolve(key !== undefined ? value?.[key] : value?.[+index]);
    return value ?? dataAt(ir, [id, v.struct]);
  };
  return new Map(items.map((/** @type {any} */ item) => {
    const bone = resolve(item);
    return [bone.name, { ...bone, bone: resolve(bone.bone), constraints: (bone.constraints ?? []).map(resolve).filter(Boolean) }];
  }));
}

const parentName = (/** @type {any} */ b) => b?.parent?.struct?.match(/^pose\.bones\["(.*)"\]$/)?.[1] ?? null;

/** Every bone an IK constraint moves, by name, with that constraint and its owner. */
function ikChains(/** @type {Map<string, any>} */ bones) {
  /** @type {Map<string, { owner: string, constraint: any }>} */
  const chains = new Map();
  for (const b of bones.values()) {
    for (const c of b.constraints ?? []) {
      if (c.type !== 'IK' || !c.subtarget) continue;
      let name = b.name;
      for (let k = 0; name && (c.chain_count === 0 || k < c.chain_count); k++, name = parentName(bones.get(name))) chains.set(name, { owner: b.name, constraint: c });
    }
  }
  return chains;
}

/** The value at `path` each frame, or a constant (`blend.get` with a path made once). */
function reader(/** @type {any} */ blend, /** @type {string | null} */ path, /** @type {number} */ constant) {
  if (!path) return () => constant;
  try { blend.get(path); } catch { return () => constant; }
  return () => Number(blend.get(path) ?? constant);
}

/**
 * The hinge's allowed range about the lower bone's own X axis, from the rest pose (null: a free bend up to 150 degrees
 * in the plane the limb bends in).
 */
function hingeOf(/** @type {any} */ ...candidates) {
  for (const b of candidates) {
    if (!b) continue;
    const locked = b.lock_ik_y && b.lock_ik_z;
    if (b.use_ik_limit_x) return { min: b.ik_min_x, max: b.ik_max_x };
    if (locked) return { min: -BEND, max: BEND };
  }
  return null;
}

/**
 * A limb of the character from a role's chain (root to end; its last three bones are the upper, lower and end).
 * @param {any} character @param {Bone[]} chain
 */
export function createLimb(character, chain) {
  if (chain.length < 3) throw new Error(`A limb needs three bones, upper to end: ${chain.length} given`);
  const { rig, blend } = character, names = rig.names, index = (/** @type {string} */ n) => rig.boneIndex(n);
  const bones = poseBones(character), chains = ikChains(bones);
  const [upper, lower, end] = chain.slice(-3).map((bone) => {
    const own = bones.get(names[bone]), copies = (own?.constraints ?? []).filter((/** @type {any} */ c) => /^COPY_(TRANSFORMS|ROTATION)$/.test(c.type) && c.subtarget);
    const ik = copies.find((/** @type {any} */ c) => chains.has(c.subtarget)), fk = copies.find((/** @type {any} */ c) => c !== ik);
    return { bone, played: fk ? index(fk.subtarget) : bone, ik: ik ?? null, ikBone: ik ? ik.subtarget : chains.has(names[bone]) ? names[bone] : null };
  });
  const objectPath = `objects[${quoted(character.armature)}].pose.bones`;
  // The IK weight: the upper bone's copy of its IK side, or the IK constraint on the lower bone itself.
  const solver = lower.ikBone ? chains.get(lower.ikBone) : null;
  const weightPath = upper.ik ? `${objectPath}[${quoted(names[upper.bone])}].constraints[${quoted(upper.ik.name)}].influence`
    : solver && solver.owner === names[lower.bone] ? `${objectPath}[${quoted(solver.owner)}].constraints[${quoted(solver.constraint.name)}].influence` : null;
  const ikWeight = reader(blend, weightPath, solver ? 1 : 0);
  const control = solver ? index(solver.constraint.subtarget) : -1;
  // The ball of the end: its child farthest from it at rest (Toes, not a mechanism bone at the ankle), on the drawn
  // chain or the played one, and where it sits in the end's own space.
  const ball = (() => {
    const rest = createPoseApi(Float32Array.from(rig.rest), rig.parents, () => ROOT), at = new Vector3(), of = new Vector3(), inverse = new Matrix();
    let found = null, farthest = 0;
    for (let k = 0; k < rig.parents.length; k++) {
      if (rig.parents[k] !== end.bone && rig.parents[k] !== end.played) continue;
      worldOf(rest, k, at);
      worldOf(rest, rig.parents[k], of);
      if (Vector3.Distance(at, of) <= farthest) continue;
      farthest = Vector3.Distance(at, of);
      rest.world(rig.parents[k]).invertToRef(inverse);
      found = { bone: k, offset: Vector3.TransformCoordinates(at, inverse) };
    }
    return found;
  })();
  const hinge = hingeOf(bones.get(names[lower.played]), lower.ikBone && bones.get(lower.ikBone));

  // At rest: the bones' lengths, and where the end sits in the control's space (the IK reaches the control's place).
  const rest = createPoseApi(Float32Array.from(rig.rest), rig.parents, () => ROOT);
  const a = new Vector3(), b = new Vector3(), c = new Vector3(), t = new Vector3(), aim = new Vector3(), goal = new Vector3(), n = new Vector3(), u = new Vector3(), v = new Vector3();
  const endWorld = new Quaternion(), local = new Quaternion(), turn = new Quaternion();
  const endInControl = new Vector3(), inverse = new Matrix();
  worldOf(rest, upper.played, a); worldOf(rest, lower.played, b); worldOf(rest, end.played, c);
  const upperLength = Vector3.Distance(a, b), lowerLength = Vector3.Distance(b, c), length = upperLength + lowerLength;
  if (control >= 0) {
    rest.world(control).invertToRef(inverse);
    Vector3.TransformCoordinatesToRef(c, inverse, endInControl);
  }
  const bend = new Vector3(1, 0, 0), axis = new Vector3();
  // How far the hinge bends, and to which side of its X axis until the limb is played bent.
  const reach = hinge ? Math.max(Math.abs(hinge.min), Math.abs(hinge.max)) || BEND : BEND;
  let side = hinge ? Math.sign(hinge.max + hinge.min) || 1 : 1;

  /** The end's world position as the IK will place it: the control's place, carrying the end's rest offset. */
  const fromControl = (/** @type {Pose} */ pose, /** @type {Vector3} */ out) => Vector3.TransformCoordinatesToRef(endInControl, pose.world(control), out);

  /** Bends the played bones so the end reaches `target` (two-bone, hinge limited), keeping the end's world rotation. */
  function solve(/** @type {Pose} */ pose, /** @type {Vector3} */ goal, /** @type {number} */ weight) {
    const target = goal.subtractToRef(shift(pose, t), aim);
    worldOf(pose, upper.played, a); worldOf(pose, lower.played, b); worldOf(pose, end.played, c, endWorld);
    const la = Vector3.Distance(a, b), lb = Vector3.Distance(b, c), d = Math.min(Vector3.Distance(a, target), la + lb - 1e-4);
    b.subtractToRef(a, u); c.subtractToRef(b, v);
    // The hinge: the lower bone's X axis when the rig locks it so, else the plane the limb bends in; either way on the
    // side the limb is played bent to (kept while it is straight), so the solve never flips the knee.
    Vector3.CrossToRef(u, v, n);
    const bent = n.length() > 0.05 * la * lb;
    if (hinge) {
      Vector3.TransformNormalToRef(Vector3.RightReadOnly, pose.world(lower.played), axis);
      if (bent) side = Math.sign(Vector3.Dot(axis, n)) || side;
      n.copyFrom(axis).scaleInPlace(side);
    } else if (bent) bend.copyFrom(n);
    else n.copyFrom(bend);
    n.normalize();
    const now = Math.atan2(Vector3.Dot(Vector3.CrossToRef(u, v, t), n), Vector3.Dot(u, v));
    const want = Math.acos(Math.max(-1, Math.min(1, (d * d - la * la - lb * lb) / (2 * la * lb))));
    const delta = Math.min(reach, want) - now;
    turnWorld(pose, lower.played, about(n, delta, turn), weight);
    worldOf(pose, end.played, c);
    c.subtractToRef(a, u).normalize();
    target.subtractToRef(a, v).normalize();
    turnWorld(pose, upper.played, between(u, v, turn), weight);
    // The end keeps the world rotation it was played with.
    worldOf(pose, end.played, null, local);
    turnWorld(pose, end.played, endWorld.multiplyToRef(Quaternion.InverseToRef(local, local), turn), 1);
  }

  /**
   * Where the limb hangs less where its played bones are: a rig's constraints may place its FK chain (CloudRig's
   * FK-HNG-Thigh.L copies ROOT-Thigh.L), which before the solve still sits at rest; the chain's own upper bone hangs
   * from its parents. Into `out`.
   */
  function shift(/** @type {Pose} */ pose, /** @type {Vector3} */ out) {
    if (upper.played === upper.bone) return out.setAll(0);
    worldOf(pose, upper.bone, out);
    worldOf(pose, upper.played, c);
    return out.subtractInPlace(c);
  }

  /**
   * A point of the limb as the rig's own solve will draw it: predicted from the posed bones, then corrected by how far
   * the solve drew it from its prediction last frame (constraints between the posed and the drawn bones, CloudRig's FK
   * hinge and IK mechanism, move it in ways a pose cannot predict).
   * @param {number} bone the drawn bone (its follower) @param {(pose: Pose, out: Vector3) => Vector3} predict
   */
  const drawnPoint = (bone, predict) => {
    const follower = (upper.played !== upper.bone || control >= 0) && bone >= 0 ? character.bone?.(names[bone]) ?? null : null;
    // Last frame's difference, carried on at the rate it changed, so a body turning steadily is not followed a frame late.
    const bias = new Vector3(), measured = new Vector3(), last = new Vector3(), predicted = new Vector3(), at = new Vector3();
    let frame = -1, seen = 0;
    return {
      bias,
      /** The point as the rig will draw it, into `out`. */
      at(/** @type {Pose} */ pose, /** @type {Vector3} */ out) {
        if (follower && frame !== character.frame) {
          frame = character.frame;
          if (seen) {
            last.copyFrom(measured);
            follower.computeWorldMatrix(true).getTranslationToRef(at).subtractToRef(predicted, measured);
            bias.copyFrom(measured);
            // At most 1 cm a frame of carried change: a jump (a switch, a new step) is taken as it is, not doubled.
            if (seen > 1) { at.copyFrom(measured).subtractInPlace(last); if (at.length() < 0.01) bias.addInPlace(at); }
            seen++;
          }
        }
        return predict(pose, out).addInPlace(bias);
      },
      /** Remembers this frame's prediction, once posed. */
      posed(/** @type {Pose} */ pose) { predict(pose, predicted); seen ||= 1; },
    };
  };
  const endPoint = drawnPoint(end.bone, (pose, out) => {
    if (control >= 0 && ikWeight() >= 0.5) return fromControl(pose, out);
    worldOf(pose, end.played, out);
    return out.addInPlace(shift(pose, t));
  });
  const ballPoint = ball && drawnPoint(rig.parents[ball.bone] === end.bone ? ball.bone : -1, (pose, out) =>
    Vector3.TransformCoordinatesToRef(ball.offset, pose.world(end.played), out).addInPlace(shift(pose, t)));

  return {
    /** The chain's full length at rest, in the rig's units. */
    length,
    /** The end bone as played (the FK one on a rig with both). */
    end: end.played,
    /** How much the limb is in IK now, 0 to 1. */
    ikWeight,
    /** The end's world position as played (from the IK control while in IK), into `out`. */
    endAt(/** @type {Pose} */ pose, /** @type {Vector3} */ out) { return endPoint.at(pose, out); },
    /**
     * The ball of the end, where a foot rolls when its heel lifts (the played end's first child, else the end itself),
     * in world space as the rig will draw it, into `out`.
     */
    ballAt(/** @type {Pose} */ pose, /** @type {Vector3} */ out) { return (ballPoint ?? endPoint).at(pose, out); },
    /** How bent the played limb is, in radians (0 straight). */
    bend(/** @type {Pose} */ pose) {
      worldOf(pose, upper.played, a); worldOf(pose, lower.played, b); worldOf(pose, end.played, c);
      return Vector3.GetAngleBetweenVectors(b.subtractToRef(a, u), c.subtractToRef(b, v), Vector3.CrossToRef(u, v, n));
    },
    /** How far the limb's end is from its root when it is bent by `angle` radians. */
    span: (/** @type {number} */ angle) => Math.sqrt(upperLength * upperLength + lowerLength * lowerLength + 2 * upperLength * lowerLength * Math.cos(angle)),
    /** How far `point` is from the limb's root, as the end is aimed (in the frame `endAt` and `ballAt` give). */
    extension(/** @type {Pose} */ pose, /** @type {Vector3} */ point) {
      worldOf(pose, upper.played, a);
      return Vector3.Distance(a.addInPlace(shift(pose, t)).addInPlace(endPoint.bias), point);
    },
    /** The root of the limb (the upper bone's head) in world space, into `out`. */
    rootAt(/** @type {Pose} */ pose, /** @type {Vector3} */ out) { worldOf(pose, upper.bone, out); return out; },
    /**
     * Moves the end toward `target` by `weight`, then turns it in world space by `rotation` (when given): through the IK
     * control by the IK weight, and the played bones by the rest. Returns how far the target is beyond full reach.
     * @param {Pose} pose @param {Vector3} target @param {number} weight @param {Quaternion | null} [rotation]
     */
    reach(pose, target, weight, rotation = null) {
      endPoint.at(pose, c);
      const ik = control >= 0 ? ikWeight() : 0, aim = target.subtractToRef(endPoint.bias, goal);
      if (ik > 0) {
        fromControl(pose, c);
        moveWorld(pose, control, aim.subtractToRef(c, t).scaleInPlace(weight));
        if (rotation) turnWorld(pose, control, rotation, weight);
      }
      if (ik < 1) {
        solve(pose, aim, weight);
        if (rotation) turnWorld(pose, end.played, rotation, weight);
      }
      endPoint.posed(pose);
      ballPoint?.posed(pose);
      worldOf(pose, upper.bone, a);
      return Math.max(0, Vector3.Distance(a, target) - length);
    },
  };
}
