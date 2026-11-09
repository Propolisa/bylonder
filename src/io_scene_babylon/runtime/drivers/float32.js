// SPDX-License-Identifier: MIT OR Apache-2.0
// @ts-check
// Float32 arithmetic helpers. Blender computes transforms in float32; rounding after every operation reproduces its
// choices at exact half turns and other boundaries.

/** @typedef {number[][]} Mat3 rows of a 3x3 matrix acting on column vectors */

export const f = Math.fround;
/** float32 sum of products, left to right. @param {number[]} a @param {number[]} b */
export const dot = (a, b) => a.reduce((sum, v, i) => (i === 0 ? f(v * b[0]) : f(sum + f(v * b[i]))), 0);

/** @param {Mat3} a @param {Mat3} b @returns {Mat3} */
export const mul3 = (a, b) => a.map((row) => [0, 1, 2].map((c) => dot(row, column(b, c))));
/** @param {Mat3} a @param {number[]} v */
export const apply3 = (a, v) => a.map((row) => dot(row, v));
/** @param {Mat3} a @param {number} c */
export const column = (a, c) => [a[0][c], a[1][c], a[2][c]];
export const length = (/** @type {number[]} */ v) => Math.hypot(...v);
/** @param {Mat3} a */
export const det3 = (a) => {
  const m = (/** @type {number} */ r0, /** @type {number} */ c0, /** @type {number} */ r1, /** @type {number} */ c1) => f(f(a[r0][c0] * a[r1][c1]) - f(a[r0][c1] * a[r1][c0]));
  return f(f(f(a[0][0] * m(1, 1, 2, 2)) - f(a[0][1] * m(1, 0, 2, 2))) + f(a[0][2] * m(1, 0, 2, 1)));
};

