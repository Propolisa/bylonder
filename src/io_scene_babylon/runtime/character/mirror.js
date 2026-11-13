// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// A pose mirrored left to right, as Blender's Paste Flipped does: each bone takes its partner's change from rest
// (Left and Right, .L and .R, _L and _R in its name), flipped across the armature's X, so bones whose own axes differ
// from side to side mirror correctly as long as the rest pose is symmetric.
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core';
import { STRIDE } from './pose.js';

const SIDES = [[/Left/g, 'Right'], [/Right/g, 'Left'], [/\.L(?=$|\.)/g, '.R'], [/\.R(?=$|\.)/g, '.L'], [/_L(?=$|[._])/g, '_R'], [/_R(?=$|[._])/g, '_L']];
const FLIP = Matrix.Scaling(-1, 1, 1);

/** The bone on the other side of `name`, or `name` itself. */
function partnerName(/** @type {string} */ name) {
  for (const [side, other] of SIDES) {
    const swapped = name.replace(/** @type {RegExp} */ (side), /** @type {string} */ (other));
    if (swapped !== name) return swapped;
  }
  return name;
}

/**
 * A function mirroring poses of `rig` in place.
 * @param {{ names: string[], parents: Int32Array, rest: Float32Array }} rig
 * @returns {(pose: Float32Array) => void}
 */
export function mirrorPose({ names, parents, rest }) {
  const count = names.length, index = new Map(names.map((n, i) => [n, i]));
  const partner = Int32Array.from(names, (n, i) => index.get(partnerName(n)) ?? i);
  const matrices = () => Array.from({ length: count }, () => new Matrix());
  const restArmature = matrices(), restInverse = matrices(), armature = matrices(), mirrored = matrices(), local = new Matrix(), delta = new Matrix();
  const s = new Vector3(), q = new Quaternion(), t = new Vector3();
  /** Each bone's armature-space matrix from the local pose, parents first. */
  const toArmature = (/** @type {Float32Array} */ pose, /** @type {Matrix[]} */ out) => {
    for (let i = 0; i < count; i++) {
      const o = i * STRIDE;
      s.set(pose[o + 7], pose[o + 8], pose[o + 9]);
      q.set(pose[o + 3], pose[o + 4], pose[o + 5], pose[o + 6]);
      t.set(pose[o], pose[o + 1], pose[o + 2]);
      Matrix.ComposeToRef(s, q, t, local);
      if (parents[i] < 0) out[i].copyFrom(local);
      else local.multiplyToRef(out[parents[i]], out[i]);
    }
  };
  toArmature(rest, restArmature);
  restArmature.forEach((m, i) => m.invertToRef(restInverse[i]));
  return (pose) => {
    toArmature(pose, armature);
    // Babylon's matrices apply left to right: a bone's armature matrix is its rest one, then its change.
    for (let i = 0; i < count; i++) {
      const from = partner[i];
      restInverse[from].multiplyToRef(armature[from], delta);
      FLIP.multiplyToRef(delta, delta);
      delta.multiplyToRef(FLIP, delta);
      restArmature[i].multiplyToRef(delta, mirrored[i]);
    }
    for (let i = 0; i < count; i++) {
      if (parents[i] < 0) local.copyFrom(mirrored[i]);
      else {
        mirrored[parents[i]].invertToRef(delta);
        mirrored[i].multiplyToRef(delta, local);
      }
      local.decompose(s, q, t);
      const o = i * STRIDE;
      pose[o] = t.x; pose[o + 1] = t.y; pose[o + 2] = t.z;
      pose[o + 3] = q.x; pose[o + 4] = q.y; pose[o + 5] = q.z; pose[o + 6] = q.w;
      pose[o + 7] = s.x; pose[o + 8] = s.y; pose[o + 9] = s.z;
    }
  };
}
