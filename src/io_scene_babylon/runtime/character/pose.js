// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// Poses as flat arrays: per bone, its local transform relative to its parent in Babylon's axes, STRIDE floats:
// location (x, y, z), rotation as a quaternion (x, y, z, w) and scale (x, y, z). A rig takes and gives poses in this
// layout (rig.js), and every step of the graph works on them in place, allocating nothing per frame.

export const STRIDE = 10;
const T = 0, Q = 3, S = 7;

/** A pose of `count` bones, each at identity. @param {number} count */
export function createPose(count) {
  const pose = new Float32Array(count * STRIDE);
  for (let i = 0; i < count; i++) pose.set([0, 0, 0, 0, 0, 0, 1, 1, 1, 1], i * STRIDE);
  return pose;
}

/** Normalizes the quaternion at `at`. @param {Float32Array} p @param {number} at */
function normalize(p, at) {
  const l = Math.hypot(p[at], p[at + 1], p[at + 2], p[at + 3]) || 1;
  for (let k = 0; k < 4; k++) p[at + k] /= l;
}

/**
 * `out` = `a` blended towards `b` by `w` per bone (times `mask[i]` when given): locations and scales linearly,
 * rotations by normalized lerp on the nearer hemisphere. `out` may be `a` or `b`.
 * @param {Float32Array} out @param {Float32Array} a @param {Float32Array} b @param {number} w @param {Float32Array | null} [mask]
 */
export function blendPoses(out, a, b, w, mask = null) {
  const count = out.length / STRIDE;
  for (let i = 0; i < count; i++) blendBone(out, a, b, i, mask ? w * mask[i] : w);
}

/** Bone `i` of `out` = bone `i` of `a` blended toward `b`'s by `t` (as blendPoses does). */
export function blendBone(/** @type {Float32Array} */ out, /** @type {Float32Array} */ a, /** @type {Float32Array} */ b, /** @type {number} */ i, /** @type {number} */ t) {
  const o = i * STRIDE;
  if (t <= 0) { if (out !== a) for (let k = 0; k < STRIDE; k++) out[o + k] = a[o + k]; return; }
  if (t >= 1) { if (out !== b) for (let k = 0; k < STRIDE; k++) out[o + k] = b[o + k]; return; }
  for (let k = 0; k < 3; k++) {
    out[o + T + k] = a[o + T + k] + (b[o + T + k] - a[o + T + k]) * t;
    out[o + S + k] = a[o + S + k] + (b[o + S + k] - a[o + S + k]) * t;
  }
  const q = o + Q, sign = a[q] * b[q] + a[q + 1] * b[q + 1] + a[q + 2] * b[q + 2] + a[q + 3] * b[q + 3] < 0 ? -1 : 1;
  for (let k = 0; k < 4; k++) out[q + k] = a[q + k] * (1 - t) + sign * b[q + k] * t;
  normalize(out, q);
}

/**
 * Accumulates `b` into `out` with weight `w`, for blending several poses by weights that sum to 1: start from zeros
 * (`clearPose`), accumulate each, then `finishPose`. Rotations are summed on `out`'s hemisphere, or the first one's.
 * @param {Float32Array} out @param {Float32Array} b @param {number} w
 */
export function accumulatePose(out, b, w) {
  const count = out.length / STRIDE;
  for (let i = 0; i < count; i++) {
    const o = i * STRIDE, q = o + Q;
    for (let k = 0; k < 3; k++) { out[o + T + k] += b[o + T + k] * w; out[o + S + k] += b[o + S + k] * w; }
    const sign = out[q] * b[q] + out[q + 1] * b[q + 1] + out[q + 2] * b[q + 2] + out[q + 3] * b[q + 3] < 0 ? -w : w;
    for (let k = 0; k < 4; k++) out[q + k] += b[q + k] * sign;
  }
}

/** Zeroes a pose for `accumulatePose`. @param {Float32Array} out */
export const clearPose = (out) => out.fill(0);

/** Normalizes an accumulated pose's rotations. @param {Float32Array} out */
export function finishPose(out) {
  for (let o = 0; o < out.length; o += STRIDE) {
    if (out[o + Q] === 0 && out[o + Q + 1] === 0 && out[o + Q + 2] === 0 && out[o + Q + 3] === 0) out[o + Q + 3] = 1;
    normalize(out, o + Q);
  }
}

/**
 * Adds an additive pose (`delta`: each bone's change from a reference, location added, rotation multiplied after,
 * scale multiplied) to `out` with weight `w` per bone (times `mask[i]`).
 * @param {Float32Array} out @param {Float32Array} delta @param {number} w @param {Float32Array | null} [mask]
 */
export function addPose(out, delta, w, mask = null) {
  const count = out.length / STRIDE;
  for (let i = 0; i < count; i++) {
    const t = mask ? w * mask[i] : w, o = i * STRIDE;
    if (t <= 0) continue;
    for (let k = 0; k < 3; k++) {
      out[o + T + k] += delta[o + T + k] * t;
      out[o + S + k] *= 1 + (delta[o + S + k] - 1) * t;
    }
    // The delta rotation, scaled towards identity by t (nlerp), applied in the bone's own space: q * d.
    const d = o + Q, dw = delta[d + 3] < 0 ? -1 : 1;
    let x = delta[d] * dw * t, y = delta[d + 1] * dw * t, z = delta[d + 2] * dw * t, ww = 1 + (delta[d + 3] * dw - 1) * t;
    const l = Math.hypot(x, y, z, ww) || 1;
    x /= l; y /= l; z /= l; ww /= l;
    const q = o + Q, ax = out[q], ay = out[q + 1], az = out[q + 2], aw = out[q + 3];
    out[q] = aw * x + ax * ww + ay * z - az * y;
    out[q + 1] = aw * y - ax * z + ay * ww + az * x;
    out[q + 2] = aw * z + ax * y - ay * x + az * ww;
    out[q + 3] = aw * ww - ax * x - ay * y - az * z;
  }
}

/**
 * `out` = `pose` as a delta from `reference` (location difference, rotation inverse(reference) * pose, scale ratio).
 * @param {Float32Array} out @param {Float32Array} pose @param {Float32Array} reference
 */
export function deltaPose(out, pose, reference) {
  for (let o = 0; o < out.length; o += STRIDE) {
    for (let k = 0; k < 3; k++) {
      out[o + T + k] = pose[o + T + k] - reference[o + T + k];
      out[o + S + k] = pose[o + S + k] / (reference[o + S + k] || 1);
    }
    const q = o + Q, rx = -reference[q], ry = -reference[q + 1], rz = -reference[q + 2], rw = reference[q + 3];
    const bx = pose[q], by = pose[q + 1], bz = pose[q + 2], bw = pose[q + 3];
    out[q] = rw * bx + rx * bw + ry * bz - rz * by;
    out[q + 1] = rw * by - rx * bz + ry * bw + rz * bx;
    out[q + 2] = rw * bz + rx * by - ry * bx + rz * bw;
    out[q + 3] = rw * bw - rx * bx - ry * by - rz * bz;
  }
}

/**
 * The largest difference between two poses: location in the rig's units and rotation angle in radians, over all bones.
 * @param {Float32Array} a @param {Float32Array} b
 */
export function poseDistance(a, b) {
  let move = 0, turn = 0;
  for (let o = 0; o < a.length; o += STRIDE) {
    move = Math.max(move, Math.hypot(a[o] - b[o], a[o + 1] - b[o + 1], a[o + 2] - b[o + 2]));
    const dot = Math.abs(a[o + 3] * b[o + 3] + a[o + 4] * b[o + 4] + a[o + 5] * b[o + 5] + a[o + 6] * b[o + 6]);
    turn = Math.max(turn, 2 * Math.acos(Math.min(1, dot)));
  }
  return { move, turn };
}
