// @ts-nocheck
// SPDX-License-Identifier: MIT OR Apache-2.0
// From babylon-blender-rig (scripts/native-rig.mjs).
import { eulerMatrix } from './math.js';

// Euler angles per axis [x, y, z] of a 3x3 (copy_rotation spec, Euler conventions). Order 'ABC' means
// R = R_C @ R_B @ R_A. Works on non-orthogonal input using exactly the spec's entries. Returns both solutions.
const EVEN = ['XYZ', 'YZX', 'ZXY'];
const AX = { X: 0, Y: 1, Z: 2 };

export function eulerSolutions(m, order) {
  if (!EVEN.includes(order)) {
    // Beyond the spec: an odd order permutes the same entries and negates the angles (the spec's transpose of the
    // reversed order agrees only for orthogonal input).
    return eulerSolutionsAt((r, c) => m[c * 4 + r], order).map((e) => e.map((v) => -v));
  }
  return eulerSolutionsAt((r, c) => m[c * 4 + r], order);
}

function eulerSolutionsAt(get, order) {
  const p = order.split('').map((a) => AX[a]);
  const n = (r, c) => get(p[r], p[c]);
  const h = Math.hypot(n(0, 0), n(1, 0));
  const a = [Math.atan2(n(2, 1), n(2, 2)), Math.atan2(-n(2, 0), h), Math.atan2(n(1, 0), n(0, 0))];
  const b = [Math.atan2(-n(2, 1), -n(2, 2)), Math.atan2(-n(2, 0), -h), Math.atan2(-n(1, 0), -n(0, 0))];
  return [a, b].map((s) => { const e = [0, 0, 0]; p.forEach((axis, i) => { e[axis] = s[i]; }); return e; });
}

const sumAbs = (e) => Math.abs(e[0]) + Math.abs(e[1]) + Math.abs(e[2]);

export function eulerOf(m, order) {
  const [a, b] = eulerSolutions(m, order);
  return sumAbs(b) < sumAbs(a) ? b : a;
}

// The solution nearest `ref`, each angle moved by whole turns to within pi of ref's.
export function eulerCompatible(m, order, ref) {
  const near = (e) => e.map((v, i) => v + 2 * Math.PI * Math.round((ref[i] - v) / (2 * Math.PI)));
  const [a, b] = eulerSolutions(m, order).map(near);
  const dist = (e) => sumAbs(e.map((v, i) => v - ref[i]));
  return dist(b) < dist(a) ? b : a;
}

export const euler = (e, order) => eulerMatrix(e, order);
