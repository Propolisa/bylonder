// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// Offline analysis of a rig's clips: the pose in world space (positions and rotations of every bone from the local pose
// and the rig's root), and the ground speed a locomotion clip's feet imply. Rotations compose as Babylon's do: a
// child's world rotation is its local rotation, then its parent's. Bones are assumed unscaled; a root's uniform scale
// is applied to positions. The effects' per-frame maths is in effects/space.js.
import { STRIDE } from './pose.js';

/** @typedef {{ names: string[], parents: Int32Array }} Skeleton */

// Quaternions as [x, y, z, w] in arrays at offsets; `q * r` applies r first, then q (Babylon's multiply is r.multiply(q)).
/** out = a * b (b first, then a) */
function mul(/** @type {Float32Array | number[]} */ out, /** @type {number} */ o, /** @type {ArrayLike<number>} */ a, /** @type {number} */ i, /** @type {ArrayLike<number>} */ b, /** @type {number} */ j) {
  const ax = a[i], ay = a[i + 1], az = a[i + 2], aw = a[i + 3], bx = b[j], by = b[j + 1], bz = b[j + 2], bw = b[j + 3];
  out[o] = aw * bx + ax * bw + ay * bz - az * by;
  out[o + 1] = aw * by - ax * bz + ay * bw + az * bx;
  out[o + 2] = aw * bz + ax * by - ay * bx + az * bw;
  out[o + 3] = aw * bw - ax * bx - ay * by - az * bz;
}
/** Rotates vector (x, y, z) by quaternion q at `i` into out[o..o+2]. */
function rotate(/** @type {Float32Array | number[]} */ out, /** @type {number} */ o, /** @type {ArrayLike<number>} */ q, /** @type {number} */ i, /** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ z) {
  const qx = q[i], qy = q[i + 1], qz = q[i + 2], qw = q[i + 3];
  const tx = 2 * (qy * z - qz * y), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * y - qy * x);
  out[o] = x + qw * tx + (qy * tz - qz * ty);
  out[o + 1] = y + qw * ty + (qz * tx - qx * tz);
  out[o + 2] = z + qw * tz + (qx * ty - qy * tx);
}
/**
 * The pose in world space, kept in step with a local pose.
 * @param {Skeleton} skeleton
 */
export function createWorldPose({ parents }) {
  const count = parents.length, position = new Float32Array(count * 3), rotation = new Float32Array(count * 4);
  const root = { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: 1 };
  const t = [0, 0, 0];
  /** World position and rotation of bone `i` from its local transform and its parent's world. */
  const place = (/** @type {Float32Array} */ pose, /** @type {number} */ i) => {
    const p = parents[i], o = i * STRIDE;
    if (p < 0) {
      rotate(t, 0, root.rotation, 0, pose[o] * root.scale, pose[o + 1] * root.scale, pose[o + 2] * root.scale);
      for (let k = 0; k < 3; k++) position[i * 3 + k] = root.position[k] + t[k];
      mul(rotation, i * 4, root.rotation, 0, pose, o + 3);
    } else {
      rotate(t, 0, rotation, p * 4, pose[o] * root.scale, pose[o + 1] * root.scale, pose[o + 2] * root.scale);
      for (let k = 0; k < 3; k++) position[i * 3 + k] = position[p * 3 + k] + t[k];
      mul(rotation, i * 4, rotation, p * 4, pose, o + 3);
    }
  };
  return {
    position, rotation, root,
    /** Places every bone from `pose` (parents come before children). @param {Float32Array} pose */
    update(pose) { for (let i = 0; i < count; i++) place(pose, i); },
  };
}

/**
 * The ground speed a locomotion clip's feet imply: while a foot is planted it moves backwards at the speed the body
 * moves forwards, in the rig's units per second.
 * @param {import('./clip.js').Clip} clip @param {Skeleton & { rest: Float32Array }} skeleton @param {number[]} feet bone indices
 */
export function clipSpeed(clip, skeleton, feet) {
  const world = createWorldPose(skeleton), pose = Float32Array.from(skeleton.rest), track = feet.map(() => /** @type {number[][]} */ ([]));
  // A rig whose runtime solves it (constraints place its feet) is solved at each frame; else its bones are its keys.
  const solveAt = /** @type {any} */ (skeleton).solveAt;
  for (let f = 0; f < clip.frames; f++) {
    pose.set(skeleton.rest);
    sampleFrame(clip, f, pose);
    if (solveAt) {
      const solved = solveAt(pose, clip.bones);
      feet.forEach((foot, k) => { const m = solved(skeleton.names[foot]).m; track[k].push([m[12], m[13], m[14]]); });
      continue;
    }
    world.update(pose);
    feet.forEach((foot, k) => track[k].push(Array.from(world.position.subarray(foot * 3, foot * 3 + 3))));
  }
  // A planted foot slides back steadily at the body's speed; swinging, it moves the other way, faster. So each foot's
  // speed along the way it moves at its lowest frame, over the frames it moves that way: their median, of both feet.
  const speeds = track.flatMap((points) => {
    const n = points.length, heights = points.map((p) => p[1]), lowest = heights.indexOf(Math.min(...heights));
    const step = (/** @type {number} */ f) => { const a = points[(f + n) % n], b = points[(f + 1 + n) % n]; return [b[0] - a[0], b[2] - a[2]]; };
    const at = step(lowest), size = Math.hypot(at[0], at[1]);
    if (size < 1e-6) return [];
    const way = [at[0] / size, at[1] / size];
    return Array.from({ length: n - 1 }, (_, f) => { const d = step(f); return (d[0] * way[0] + d[1] * way[1]) * clip.fps; }).filter((v) => v > 0);
  });
  speeds.sort((x, y) => x - y);
  return speeds.length ? speeds[Math.floor(speeds.length / 2)] : 0;
}

/** Writes a clip's frame `f` into `out` at its bones. */
function sampleFrame(/** @type {import('./clip.js').Clip} */ clip, /** @type {number} */ f, /** @type {Float32Array} */ out) {
  const size = clip.bones.length * STRIDE;
  for (let j = 0; j < clip.bones.length; j++) out.set(clip.data.subarray(f * size + j * STRIDE, f * size + (j + 1) * STRIDE), clip.bones[j] * STRIDE);
}
