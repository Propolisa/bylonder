// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// World-space edits of an effect's pose, which is written in each bone's own space. Babylon composes a bone's world
// rotation as parent ⊗ local, so a turn T applied after the world rotation W gives the
// local L' = L W⁻¹ T W (Hamilton order, as Babylon's multiply), without needing the parent. Allocation-free: results go into the caller's objects.
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core';

/** @typedef {import('../api.js').Pose} Pose @typedef {import('../api.js').Bone} Bone */

const IDENTITY = Quaternion.Identity(), world = new Quaternion(), local = new Quaternion(), inverse = new Quaternion(), part = new Quaternion(), scale = new Vector3(), at = new Vector3();

/** The bone's world position and rotation into `position` and `rotation` (either may be null). */
export function worldOf(/** @type {Pose} */ pose, /** @type {Bone} */ bone, /** @type {Vector3 | null} */ position, /** @type {Quaternion | null} */ rotation = null) {
  pose.world(bone).decompose(scale, rotation ?? world, position ?? at);
}

/** Turns `bone` in world space by `turn` (applied after its world rotation), scaled toward identity by `amount`. */
export function turnWorld(/** @type {Pose} */ pose, /** @type {Bone} */ bone, /** @type {Quaternion} */ turn, amount = 1) {
  if (amount <= 0) return;
  pose.world(bone).decompose(scale, world, at);
  pose.rotation(bone, local);
  const t = amount >= 1 ? turn : Quaternion.SlerpToRef(IDENTITY, turn, amount, part);
  Quaternion.InverseToRef(world, inverse);
  local.multiplyToRef(inverse, local).multiplyToRef(t, local).multiplyToRef(world, local).normalize();
  pose.setRotation(bone, local);
}

/** Moves `bone` by a world-space `offset`, written as a change of its local location. */
export function moveWorld(/** @type {Pose} */ pose, /** @type {Bone} */ bone, /** @type {Vector3} */ offset) {
  // The parent's world rotation is W L⁻¹, so world to parent space is W⁻¹, then L.
  pose.world(bone).decompose(scale, world, at);
  pose.rotation(bone, local);
  Quaternion.InverseToRef(world, inverse);
  offset.rotateByQuaternionToRef(inverse, at);
  at.rotateByQuaternionToRef(local, at).scaleInPlace(1 / (scale.x || 1));
  pose.addLocation(bone, at);
}

/** The rotation taking unit direction `from` onto unit direction `to`, into `out`. */
export function between(/** @type {Vector3} */ from, /** @type {Vector3} */ to, /** @type {Quaternion} */ out) {
  return Quaternion.FromUnitVectorsToRef(from, to, out);
}

/** A rotation of `angle` radians about unit `axis`, into `out`. */
export const about = (/** @type {Vector3} */ axis, /** @type {number} */ angle, /** @type {Quaternion} */ out) => Quaternion.RotationAxisToRef(axis, angle, out);

/** The angle of a rotation, 0 to π. */
export const angleOf = (/** @type {Quaternion} */ q) => 2 * Math.acos(Math.min(1, Math.abs(q.w)));

/** Moves `value` toward `target` by a critically damped spring of `halfLife` seconds; `state` holds [value, velocity]. */
export function damp(/** @type {Float32Array | number[]} */ state, /** @type {number} */ i, /** @type {number} */ target, /** @type {number} */ halfLife, /** @type {number} */ dt) {
  const y = (2 * Math.LN2) / Math.max(halfLife, 1e-4), j0 = state[i] - target, j1 = state[i + 1] + j0 * y, e = Math.exp(-y * dt);
  state[i] = e * (j0 + j1 * dt) + target;
  state[i + 1] = e * (state[i + 1] - j1 * y * dt);
  return state[i];
}

const FORWARD = new Vector3(0, 0, 1);
/** The character's facing, unit and level, into `out`. */
export function facing(/** @type {any} */ character, /** @type {Vector3} */ out) {
  const given = character.movement?.facing;
  if (given) return out.copyFrom(given);
  character.node.getDirectionToRef(FORWARD, out);
  return out.set(out.x, 0, out.z).normalize();
}

