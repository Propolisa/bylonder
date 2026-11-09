// SPDX-License-Identifier: MIT OR Apache-2.0
// @ts-check
// Rotation readings of a driver's transform channel: Euler angles (with the AUTO compatibility step), quaternion,
// swing and twist, and the rotational difference. This is the one module boundary of drivers that may be swapped
// for a ported unit: everything it needs comes in as a column-normalized 3x3 matrix.
import { f, dot, det3 } from './float32.js';

/** @typedef {number[][]} Mat3 rows of a 3x3 matrix acting on column vectors */

const EULER_ORDERS = ['XYZ', 'XZY', 'YXZ', 'YZX', 'ZXY', 'ZYX'];
/** @type {Record<string, number>} */
export const AXIS = { X: 0, Y: 1, Z: 2, W: -1 };
// Measured: c = 3.7475e-5 still counts as gimbal lock, 3.7952e-5 does not.
const GIMBAL_EPSILON = 3.77e-5;
const QUATERNION_UNIT_TOLERANCE = 0.0006;
const F32_PI = Math.fround(Math.PI);
const F32_TWO_PI = Math.fround(2 * Math.PI);

/** Euler angles of a rotation matrix, for an order "ABC" (A applied first). @param {Mat3} n @param {string} order */
export function matrixToEuler(n, order) {
  const [i, j, k] = [...order].map((axis) => AXIS[axis]);
  const p = ['XYZ', 'YZX', 'ZXY'].includes(order) ? 1 : -1;
  const at = (/** @type {number} */ y, /** @type {number} */ x) => f(Math.atan2(y, x));
  const c = f(Math.sqrt(f(f(n[i][i] * n[i][i]) + f(n[j][i] * n[j][i]))));
  const angles = [0, 0, 0];
  if (c > GIMBAL_EPSILON) {
    const first = [at(p * n[k][j], n[k][k]), at(-p * n[k][i], c), at(p * n[j][i], n[i][i])];
    const second = [at(-p * n[k][j], -n[k][k]), at(-p * n[k][i], -c), at(-p * n[j][i], -n[i][i])];
    const size = (/** @type {number[]} */ e) => f(f(Math.abs(e[0]) + Math.abs(e[1])) + Math.abs(e[2]));
    const chosen = size(second) < size(first) ? second : first;
    [angles[i], angles[j], angles[k]] = chosen;
  } else {
    angles[i] = at(-p * n[j][k], n[j][j]);
    angles[j] = at(-p * n[k][i], c);
  }
  return angles;
}

/** C round, halves away from zero. @param {number} x */
const roundHalfAway = (x) => Math.sign(x) * Math.floor(Math.abs(x) + 0.5);

/** Moves each angle by whole turns toward the reference, in float32 as Blender does. @param {number[]} angles @param {number[]} reference */
function compatibleEuler(angles, reference) {
  return angles.map((angle, axis) => {
    const r = f(reference[axis]);
    const e = f(angle);
    const d = f(r - e);
    if (Math.abs(d) <= F32_PI) return e;
    const turns = roundHalfAway(f(d / F32_TWO_PI));
    return f(e + f(turns * F32_TWO_PI));
  });
}

/** Quaternion (w, x, y, z), w >= 0, of a matrix whose columns are normalized. @param {Mat3} n */
export function matrixToQuaternion(n) {
  const { q } = rawQuaternion(n);
  const sign = q[0] < 0 ? -1 : 1;
  // Blender rescales only a clearly non-unit result (from shear); measured threshold on the squared length.
  const squared = dot(q, q);
  if (Math.abs(squared - 1) < QUATERNION_UNIT_TOLERANCE) return q.map((v) => sign * v);
  const scale = f(1 / f(Math.sqrt(squared)));
  return q.map((v) => f(sign * v * scale));
}

/** @param {Mat3} n */
export function rawQuaternion(n) {
  const m = det3(n) < 0 ? n.map((row) => row.map((v) => -v)) : n;
  // The branch is picked from the diagonal signs, not the trace; this matters once shear is in the matrix.
  const half = (/** @type {number} */ t) => f(2 * f(Math.sqrt(t)));
  const sum = (/** @type {number[]} */ v) => v.reduce((acc, x) => f(acc + x), 1);
  const diff = (/** @type {number} */ x, /** @type {number} */ y) => f(x - y);
  const plus = (/** @type {number} */ x, /** @type {number} */ y) => f(x + y);
  let q;
  if (m[2][2] >= 0 && m[0][0] >= -m[1][1]) {
    const s = half(sum([m[0][0], m[1][1], m[2][2]])), r = f(1 / s);
    q = [f(0.25 * s), f(diff(m[2][1], m[1][2]) * r), f(diff(m[0][2], m[2][0]) * r), f(diff(m[1][0], m[0][1]) * r)];
  } else if (m[2][2] < 0 && m[0][0] > m[1][1]) {
    const s = half(sum([m[0][0], -m[1][1], -m[2][2]])), r = f(1 / s);
    q = [f(diff(m[2][1], m[1][2]) * r), f(0.25 * s), f(plus(m[0][1], m[1][0]) * r), f(plus(m[0][2], m[2][0]) * r)];
  } else if (m[2][2] < 0) {
    const s = half(sum([-m[0][0], m[1][1], -m[2][2]])), r = f(1 / s);
    q = [f(diff(m[0][2], m[2][0]) * r), f(plus(m[0][1], m[1][0]) * r), f(0.25 * s), f(plus(m[1][2], m[2][1]) * r)];
  } else {
    const s = half(sum([-m[0][0], -m[1][1], m[2][2]])), r = f(1 / s);
    q = [f(diff(m[1][0], m[0][1]) * r), f(plus(m[0][2], m[2][0]) * r), f(plus(m[1][2], m[2][1]) * r), f(0.25 * s)];
  }
  return { q, m };
}

/** @param {number[]} a @param {number[]} b quaternions w, x, y, z */
const quaternionProduct = ([aw, ax, ay, az], [bw, bx, by, bz]) => [
  dot([aw, -ax, -ay, -az], [bw, bx, by, bz]),
  dot([aw, ax, ay, -az], [bx, bw, bz, by]),
  dot([aw, -ax, ay, az], [by, bz, bw, bx]),
  dot([aw, ax, -ay, az], [bz, by, bx, bw]),
];

/** Swing and twist about one axis, as (W, X, Y, Z) readings. @param {number[]} q @param {number} axis */
function swingTwist(q, axis) {
  const qa = q[axis + 1];
  const twistAngle = f(2 * f(Math.atan2(qa, q[0])));
  const size = f(Math.sqrt(f(f(q[0] * q[0]) + f(qa * qa))));
  const twist = size === 0 ? [1, 0, 0, 0] : [f(q[0] / size), 0, 0, 0];
  if (size !== 0) twist[axis + 1] = f(qa / size);
  const swing = quaternionProduct(q, [twist[0], -twist[1], -twist[2], -twist[3]]);
  const halfAngle = (/** @type {number} */ v) => f(2 * f(Math.asin(clampUnit(v))));
  const result = [f(2 * f(Math.acos(clampUnit(swing[0])))), halfAngle(swing[1]), halfAngle(swing[2]), halfAngle(swing[3])];
  result[axis + 1] = twistAngle;
  return result;
}

const clampUnit = (/** @type {number} */ v) => Math.min(1, Math.max(-1, v));

/**
 * One rotation channel (ROT_W, ROT_X, ROT_Y, ROT_Z) of a matrix whose columns are normalized.
 * @param {Mat3} n @param {string} mode the target's rotation mode: AUTO, an Euler order, QUATERNION or SWING_TWIST_*
 * @param {string} channel @param {string} objectMode the object's own rotation mode (used by AUTO)
 * @param {number[]} objectEuler the object's rotation_euler (the AUTO reference)
 */
export function readRotation(n, mode, channel, objectMode, objectEuler) {
  const axis = AXIS[channel.slice(-1)];
  if (mode === 'QUATERNION') return matrixToQuaternion(n)[axis + 1];
  if (mode.startsWith('SWING_TWIST_')) return swingTwist(matrixToQuaternion(n), AXIS[mode.slice(-1)])[axis + 1];
  if (axis < 0) return 0;
  if (mode === 'AUTO' && EULER_ORDERS.includes(objectMode)) return compatibleEuler(matrixToEuler(n, objectMode), objectEuler)[axis];
  return matrixToEuler(n, mode === 'AUTO' ? 'XYZ' : mode)[axis];
}

/** Angle between two rotations given as matrices whose columns are normalized. @param {Mat3} a @param {Mat3} b */
export function rotationDifference(a, b) {
  const qa = matrixToQuaternion(a), qb = matrixToQuaternion(b);
  const w = quaternionProduct([qa[0], -qa[1], -qa[2], -qa[3]], qb)[0];
  return f(2 * f(Math.acos(clampUnit(Math.abs(w)))));
}

