// @ts-nocheck
// SPDX-License-Identifier: MIT OR Apache-2.0
// From babylon-blender-rig (scripts/native-rig.mjs).
// 4x4 matrices for column vectors (p' = M p), stored column-major in a Float64Array(16): M[c * 4 + r].
// The layout equals Babylon's Matrix.m, so matrices copy across unchanged.

import { composeBasis, ROT } from './rig/m4.js';

export const mat = () => identity(new Float64Array(16));

export function identity(out) {
  out.fill(0);
  out[0] = out[5] = out[10] = out[15] = 1;
  return out;
}

export const clone = (m) => new Float64Array(m);
export const get = (m, r, c) => m[c * 4 + r];

export function fromRows(rows) {
  const out = new Float64Array(16);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) out[c * 4 + r] = rows[r][c];
  return out;
}

export function toRows(m) {
  return [0, 1, 2, 3].map((r) => [0, 1, 2, 3].map((c) => m[c * 4 + r]));
}

export function mul(a, b, out = new Float64Array(16)) {
  const a0 = a[0], a1 = a[1], a2 = a[2], a3 = a[3], a4 = a[4], a5 = a[5], a6 = a[6], a7 = a[7];
  const a8 = a[8], a9 = a[9], a10 = a[10], a11 = a[11], a12 = a[12], a13 = a[13], a14 = a[14], a15 = a[15];
  for (let c = 0; c < 16; c += 4) {
    const b0 = b[c], b1 = b[c + 1], b2 = b[c + 2], b3 = b[c + 3];
    out[c] = a0 * b0 + a4 * b1 + a8 * b2 + a12 * b3;
    out[c + 1] = a1 * b0 + a5 * b1 + a9 * b2 + a13 * b3;
    out[c + 2] = a2 * b0 + a6 * b1 + a10 * b2 + a14 * b3;
    out[c + 3] = a3 * b0 + a7 * b1 + a11 * b2 + a15 * b3;
  }
  return out;
}

export const mul3 = (...ms) => ms.reduce((acc, m) => mul(acc, m));

export function invert(m, out = new Float64Array(16)) {
  const a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3], a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7];
  const a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11], a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];
  const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11, b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30, b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
  const det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!det) return identity(out);
  const d = 1 / det;
  out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * d;
  out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * d;
  out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * d;
  out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * d;
  out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * d;
  out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * d;
  out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * d;
  out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * d;
  out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * d;
  out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * d;
  out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * d;
  out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * d;
  out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * d;
  out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * d;
  out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * d;
  out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * d;
  return out;
}

// --- vectors (plain arrays) ---

export const col = (m, c) => [m[c * 4], m[c * 4 + 1], m[c * 4 + 2]];
export const translation = (m) => col(m, 3);
export function setCol(m, c, v) {
  m[c * 4] = v[0]; m[c * 4 + 1] = v[1]; m[c * 4 + 2] = v[2];
  return m;
}
export const setTranslation = (m, v) => setCol(m, 3, v);
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scaleV = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const lerpV = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const len = (a) => Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]);
export const normalize = (a) => {
  const l = len(a);
  return l ? scaleV(a, 1 / l) : [0, 0, 0];
};

export function transformPoint(m, p) {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ];
}
export function transformDir(m, p) {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2],
  ];
}

export const scaleOf = (m) => [len(col(m, 0)), len(col(m, 1)), len(col(m, 2))];

// 3x3 part as a 4x4 with no translation.
export function linear(m) {
  const out = clone(m);
  out[12] = out[13] = out[14] = 0;
  return out;
}

export function det3(m) {
  return dot(col(m, 0), cross(col(m, 1), col(m, 2)));
}

export function fromCols(x, y, z, t = [0, 0, 0]) {
  const out = mat();
  setCol(out, 0, x); setCol(out, 1, y); setCol(out, 2, z); setCol(out, 3, t);
  return out;
}

export function diag(s) {
  const out = mat();
  out[0] = s[0]; out[5] = s[1]; out[10] = s[2];
  return out;
}

export function translationMatrix(t) {
  return setTranslation(mat(), t);
}

// --- rotations ---

// Rotation of the polar decomposition (U V^T of the SVD), by Newton iteration X <- (X + X^-T) / 2.
export function polarRotation(m) {
  let x = linear(m);
  if (det3(x) < 0) for (let i = 0; i < 11; i++) x[i] = -x[i];
  for (let i = 0; i < 40; i++) {
    const it = invert(x);
    let delta = 0;
    for (let c = 0; c < 3; c++)
      for (let r = 0; r < 3; r++) {
        const v = 0.5 * (x[c * 4 + r] + it[r * 4 + c]);
        delta = Math.max(delta, Math.abs(v - x[c * 4 + r]));
        x[c * 4 + r] = v;
      }
    if (delta < 1e-15) break;
  }
  return x;
}

// Quaternions are [w, x, y, z].
export function quatFromMatrix(m) {
  const m00 = m[0], m01 = m[4], m02 = m[8], m10 = m[1], m11 = m[5], m12 = m[9], m20 = m[2], m21 = m[6], m22 = m[10];
  const tr = m00 + m11 + m22;
  let q;
  if (tr > 0) {
    const s = 2 * Math.sqrt(tr + 1);
    q = [0.25 * s, (m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s];
  } else if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    q = [(m21 - m12) / s, 0.25 * s, (m01 + m10) / s, (m02 + m20) / s];
  } else if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    q = [(m02 - m20) / s, (m01 + m10) / s, 0.25 * s, (m12 + m21) / s];
  } else {
    const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
    q = [(m10 - m01) / s, (m02 + m20) / s, (m12 + m21) / s, 0.25 * s];
  }
  return quatNormalize(q);
}

export function quatNormalize(q) {
  const l = Math.sqrt(q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]) || 1;
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}

export function matrixFromQuat(q, out = mat()) {
  const [w, x, y, z] = quatNormalize(q);
  identity(out);
  out[0] = 1 - 2 * (y * y + z * z); out[4] = 2 * (x * y - w * z); out[8] = 2 * (x * z + w * y);
  out[1] = 2 * (x * y + w * z); out[5] = 1 - 2 * (x * x + z * z); out[9] = 2 * (y * z - w * x);
  out[2] = 2 * (x * z - w * y); out[6] = 2 * (y * z + w * x); out[10] = 1 - 2 * (x * x + y * y);
  return out;
}

export function quatMul(a, b) {
  return [
    a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
    a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
    a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
    a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
  ];
}

export function slerp(a, b, t) {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  if (d < 0) { b = b.map((v) => -v); d = -d; }
  if (d > 1 - 1e-12) return quatNormalize(a.map((v, i) => v + t * (b[i] - v)));
  const th = Math.acos(Math.min(1, d)), s = Math.sin(th);
  const ka = Math.sin((1 - t) * th) / s, kb = Math.sin(t * th) / s;
  return a.map((v, i) => ka * v + kb * b[i]);
}

export function axisAngleMatrix(axis, angle) {
  const [x, y, z] = normalize(axis), h = angle / 2, s = Math.sin(h);
  return matrixFromQuat([Math.cos(h), x * s, y * s, z * s]);
}

const AXES = { X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] };

// Euler in radians; mode 'XYZ' gives R = Rz Ry Rx (the first letter applies first).
export function eulerMatrix(e, mode = 'XYZ') {
  const out = new Float64Array(16);
  EULER_ANGLES[0] = e[0]; EULER_ANGLES[1] = e[1]; EULER_ANGLES[2] = e[2];
  composeBasis(out, 0, ZERO3, 0, EULER_ANGLES, 0, ROT[mode], ONE3, 0);
  return out;
}
const EULER_ANGLES = new Float64Array(4), ZERO3 = new Float64Array(3), ONE3 = new Float64Array([1, 1, 1]);

// Euler (radians) of a pure rotation matrix for order 'XYZ' etc., near `compat` when given.
export function matrixToEuler(m, mode = 'XYZ') {
  // Express R = Rc Rb Ra with axes indices (i, j, k) = mode letters.
  const i = 'XYZ'.indexOf(mode[0]), j = 'XYZ'.indexOf(mode[1]), k = 'XYZ'.indexOf(mode[2]);
  const parity = (j - i + 3) % 3 === 1 ? 1 : -1;
  const n = normalizedCols(m);
  const R = (r, c) => n[c * 4 + r];
  const cy = Math.sqrt((R(i, i)) ** 2 + (R(j, i)) ** 2);
  const e = [0, 0, 0];
  if (cy > 1e-12) {
    e[i] = Math.atan2(parity * R(k, j), R(k, k));
    e[j] = Math.atan2(-parity * R(k, i), cy);
    e[k] = Math.atan2(parity * R(j, i), R(i, i));
  } else {
    e[i] = Math.atan2(-parity * R(j, k), R(j, j));
    e[j] = Math.atan2(-parity * R(k, i), cy);
    e[k] = 0;
  }
  return e;
}

export function normalizedCols(m) {
  const out = linear(m);
  for (let c = 0; c < 3; c++) {
    const l = len(col(out, c)) || 1;
    for (let r = 0; r < 3; r++) out[c * 4 + r] /= l;
  }
  return out;
}

export function locRotScale(loc, rot3, scale) {
  const out = mul(rot3, diag(scale));
  return setTranslation(out, loc);
}

// Translation, column lengths and normalized columns of a matrix; a negative determinant flips X (copy_transforms).
export function split(m) {
  const s = scaleOf(m), r = normalizedCols(m);
  if (det3(r) < 0) {
    s[0] = -s[0];
    for (let i = 0; i < 3; i++) r[i] = -r[i];
  }
  return { t: translation(m), r, s };
}

export function compose(t, r, s) {
  const out = new Float64Array(16);
  for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) out[c * 4 + k] = r[c * 4 + k] * s[c];
  out[12] = t[0]; out[13] = t[1]; out[14] = t[2]; out[15] = 1;
  return out;
}

// 00-foundations fix_shear.
export function fixShear(m) {
  const y0 = col(m, 1), ly = len(y0), y = scaleV(y0, 1 / ly);
  const xp = sub(col(m, 0), scaleV(y, dot(y, col(m, 0))));
  const zp = sub(col(m, 2), scaleV(y, dot(y, col(m, 2))));
  const lx = len(xp), lz = len(zp);
  const xd = normalize(add(normalize(xp), cross(y, normalize(zp))));
  const zd = cross(xd, y);
  const k = Math.sqrt(det3(m) / (ly * lx * lz));
  const out = mat();
  setCol(out, 0, scaleV(xd, k * lx)); setCol(out, 1, y0); setCol(out, 2, scaleV(zd, k * lz));
  return out;
}

export const fixShearMatrix = (m) => setTranslation(fixShear(m), translation(m));

// Shortest-arc rotation taking direction a to direction b.
export function quatFromTo(a, b, fallbackAxis = null) {
  a = normalize(a); b = normalize(b);
  const d = dot(a, b);
  if (d < -1 + 1e-12) {
    const axis = fallbackAxis ?? normalize(Math.abs(a[0]) < 0.9 ? cross(a, [1, 0, 0]) : cross(a, [0, 1, 0]));
    return [0, ...axis];
  }
  const c = cross(a, b);
  return quatNormalize([1 + d, c[0], c[1], c[2]]);
}

// Eigen-decomposition of a symmetric n x n matrix (row arrays) by Jacobi rotations: { values, vectors } (unit vectors).
export function symmetricEigen(a) {
  const n = a.length, m = a.map((r) => r.slice()), v = a.map((_, i) => a.map((__, j) => +(i === j)));
  const pairs = [];
  for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) pairs.push([p, q]);
  for (let sweep = 0; sweep < 50; sweep++) {
    if (pairs.reduce((acc, [p, q]) => acc + Math.abs(m[p][q]), 0) < 1e-30) break;
    for (const [p, q] of pairs) {
      if (Math.abs(m[p][q]) < 1e-300) continue;
      const th = (m[q][q] - m[p][p]) / (2 * m[p][q]);
      const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < n; k++) { const kp = m[k][p], kq = m[k][q]; m[k][p] = c * kp - s * kq; m[k][q] = s * kp + c * kq; }
      for (let k = 0; k < n; k++) { const pk = m[p][k], qk = m[q][k]; m[p][k] = c * pk - s * qk; m[q][k] = s * pk + c * qk; }
      for (let k = 0; k < n; k++) { const kp = v[k][p], kq = v[k][q]; v[k][p] = c * kp - s * kq; v[k][q] = s * kp + c * kq; }
    }
  }
  return { values: m.map((r, i) => r[i]), vectors: m.map((_, i) => v.map((r) => r[i])) };
}
