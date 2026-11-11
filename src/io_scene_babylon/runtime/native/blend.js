// @ts-nocheck
// SPDX-License-Identifier: MIT OR Apache-2.0
// From babylon-blender-rig (scripts/native-rig.mjs).
// Influence blend (00-foundations Influence): translation lerp, polar rotation slerp, polar stretch lerp.
// Allocation-free but for the result. When both 3x3 parts are equal (a location-only change) the blend is that 3x3
// with the translation lerped, which the general formula gives too.
import { ringMatrix } from './spaces.js';

const RA = new Float64Array(9), RB = new Float64Array(9), X = new Float64Array(9), SA = new Float64Array(9), SB = new Float64Array(9);

export function blendMatrices(a, b, f) {
  if (f >= 1) return Float64Array.from(b);
  if (f <= 0) return Float64Array.from(a);
  const out = ringMatrix();
  out[15] = 1;
  for (let i = 0; i < 3; i++) out[12 + i] = a[12 + i] + (b[12 + i] - a[12 + i]) * f;
  let same = true;
  for (let c = 0; c < 3 && same; c++) for (let r = 0; r < 3; r++) if (a[c * 4 + r] !== b[c * 4 + r]) { same = false; break; }
  if (same) {
    for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) out[c * 4 + r] = a[c * 4 + r];
    return out;
  }
  polar(a, RA); polar(b, RB);
  stretch(RA, a, SA); stretch(RB, b, SB);
  const qa = quat(RA), qb = quat(RB);
  let d = qa[0] * qb[0] + qa[1] * qb[1] + qa[2] * qb[2] + qa[3] * qb[3];
  if (d < 0) { for (let i = 0; i < 4; i++) qb[i] = -qb[i]; d = -d; }
  let q;
  if (d > 1 - 1e-12) q = normalize4(qa.map((v, i) => v + f * (qb[i] - v)));
  else {
    const th = Math.acos(Math.min(1, d)), s = Math.sin(th), ka = Math.sin((1 - f) * th) / s, kb = Math.sin(f * th) / s;
    q = normalize4(qa.map((v, i) => ka * v + kb * qb[i]));
  }
  const [w, x, y, z] = q;
  const r = [1 - 2 * (y * y + z * z), 2 * (x * y + w * z), 2 * (x * z - w * y),
    2 * (x * y - w * z), 1 - 2 * (x * x + z * z), 2 * (y * z + w * x),
    2 * (x * z + w * y), 2 * (y * z - w * x), 1 - 2 * (x * x + y * y)]; // column-major 3x3
  for (let i = 0; i < 9; i++) SA[i] += (SB[i] - SA[i]) * f;
  for (let c = 0; c < 3; c++) for (let row = 0; row < 3; row++) {
    out[c * 4 + row] = r[row] * SA[c * 3] + r[3 + row] * SA[c * 3 + 1] + r[6 + row] * SA[c * 3 + 2];
  }
  return out;
}

const normalize4 = (q) => { const l = Math.sqrt(q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]) || 1; return q.map((v) => v / l); };

// Rotation of the polar decomposition of m's 3x3 (column-major 3x3 into out), by Newton iteration X <- (X + X^-T)/2.
export function polar(m, out) {
  for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) X[c * 3 + r] = m[c * 4 + r];
  if (det(X) < 0) for (let i = 0; i < 9; i++) X[i] = -X[i];
  for (let it = 0; it < 40; it++) {
    const d = det(X);
    if (!d) break;
    // X^-T = cofactor matrix / det (column-major: entry (r, c) of X^-T is cof(r, c) / det).
    const x0 = X[0], x1 = X[1], x2 = X[2], x3 = X[3], x4 = X[4], x5 = X[5], x6 = X[6], x7 = X[7], x8 = X[8];
    const c0 = (x4 * x8 - x5 * x7) / d, c1 = (x5 * x6 - x3 * x8) / d, c2 = (x3 * x7 - x4 * x6) / d;
    const c3 = (x2 * x7 - x1 * x8) / d, c4 = (x0 * x8 - x2 * x6) / d, c5 = (x1 * x6 - x0 * x7) / d;
    const c6 = (x1 * x5 - x2 * x4) / d, c7 = (x2 * x3 - x0 * x5) / d, c8 = (x0 * x4 - x1 * x3) / d;
    // X^-T is the cofactor matrix over det; c0..c8 are the cofactors in column-major order.
    const n = [c0, c1, c2, c3, c4, c5, c6, c7, c8];
    let delta = 0;
    for (let i = 0; i < 9; i++) {
      const v = 0.5 * (X[i] + n[i]);
      delta = Math.max(delta, Math.abs(v - X[i]));
      X[i] = v;
    }
    if (delta < 1e-15) break;
  }
  out.set(X);
}

const det = (x) => x[0] * (x[4] * x[8] - x[5] * x[7]) - x[3] * (x[1] * x[8] - x[2] * x[7]) + x[6] * (x[1] * x[5] - x[2] * x[4]);

// Stretch = R^T M3 (column-major 3x3).
function stretch(r, m, out) {
  for (let c = 0; c < 3; c++) for (let row = 0; row < 3; row++) {
    out[c * 3 + row] = r[row * 3] * m[c * 4] + r[row * 3 + 1] * m[c * 4 + 1] + r[row * 3 + 2] * m[c * 4 + 2];
  }
}

function quat(r) {
  const m00 = r[0], m01 = r[3], m02 = r[6], m10 = r[1], m11 = r[4], m12 = r[7], m20 = r[2], m21 = r[5], m22 = r[8];
  const tr = m00 + m11 + m22;
  let q;
  if (tr > 0) { const s = 2 * Math.sqrt(tr + 1); q = [0.25 * s, (m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s]; }
  else if (m00 > m11 && m00 > m22) { const s = 2 * Math.sqrt(1 + m00 - m11 - m22); q = [(m21 - m12) / s, 0.25 * s, (m01 + m10) / s, (m02 + m20) / s]; }
  else if (m11 > m22) { const s = 2 * Math.sqrt(1 + m11 - m00 - m22); q = [(m02 - m20) / s, (m01 + m10) / s, 0.25 * s, (m12 + m21) / s]; }
  else { const s = 2 * Math.sqrt(1 + m22 - m00 - m11); q = [(m10 - m01) / s, (m02 + m20) / s, (m12 + m21) / s, 0.25 * s]; }
  return normalize4(q);
}
