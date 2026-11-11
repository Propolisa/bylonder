// @ts-nocheck
// SPDX-License-Identifier: MIT OR Apache-2.0
// From babylon-blender-rig (scripts/native-rig.mjs).
// The bone pose formula of 00-foundations (Bone pose) for every inheritance mode, without allocation: the same
// frames as src/bone.js parentFrames (orientation Q, extra scale for ALIGNED, origin t, location frame L), on 3x3
// scratch arrays (column-major, m[c * 3 + r]).
const Q = new Float64Array(9), L = new Float64Array(9), P3 = new Float64Array(9), A = new Float64Array(9), B = new Float64Array(9);
const T = new Float64Array(3), EXTRA = new Float64Array(3);
let hasExtra = false;

function mul3(out, a, b) {
  for (let c = 0; c < 3; c++) {
    const b0 = b[c * 3], b1 = b[c * 3 + 1], b2 = b[c * 3 + 2];
    for (let r = 0; r < 3; r++) X[c * 3 + r] = a[r] * b0 + a[3 + r] * b1 + a[6 + r] * b2;
  }
  out.set(X);
}
const X = new Float64Array(9);
const det = (m) => m[0] * (m[4] * m[8] - m[5] * m[7]) - m[3] * (m[1] * m[8] - m[2] * m[7]) + m[6] * (m[1] * m[5] - m[2] * m[4]);
const colLen = (m, c) => Math.sqrt(m[c * 3] ** 2 + m[c * 3 + 1] ** 2 + m[c * 3 + 2] ** 2);

// fix_shear (00-foundations) of m into out (3x3 column arrays).
export function fixShear(out, m) {
  const ly = colLen(m, 1), y0 = m[3] / ly, y1 = m[4] / ly, y2 = m[5] / ly;
  const dx = m[0] * y0 + m[1] * y1 + m[2] * y2, dz = m[6] * y0 + m[7] * y1 + m[8] * y2;
  const xp0 = m[0] - y0 * dx, xp1 = m[1] - y1 * dx, xp2 = m[2] - y2 * dx;
  const zp0 = m[6] - y0 * dz, zp1 = m[7] - y1 * dz, zp2 = m[8] - y2 * dz;
  const lx = Math.sqrt(xp0 * xp0 + xp1 * xp1 + xp2 * xp2), lz = Math.sqrt(zp0 * zp0 + zp1 * zp1 + zp2 * zp2);
  const nx0 = xp0 / lx, nx1 = xp1 / lx, nx2 = xp2 / lx, nz0 = zp0 / lz, nz1 = zp1 / lz, nz2 = zp2 / lz;
  // bisector of x' and y x z'
  let b0 = nx0 + (y1 * nz2 - y2 * nz1), b1 = nx1 + (y2 * nz0 - y0 * nz2), b2 = nx2 + (y0 * nz1 - y1 * nz0);
  const lb = Math.sqrt(b0 * b0 + b1 * b1 + b2 * b2) || 1;
  b0 /= lb; b1 /= lb; b2 /= lb;
  const zd0 = b1 * y2 - b2 * y1, zd1 = b2 * y0 - b0 * y2, zd2 = b0 * y1 - b1 * y0;
  const k = Math.sqrt(det(m) / (ly * lx * lz));
  const m3 = m[3], m4 = m[4], m5 = m[5];
  out[0] = b0 * k * lx; out[1] = b1 * k * lx; out[2] = b2 * k * lx;
  out[3] = m3; out[4] = m4; out[5] = m5;
  out[6] = zd0 * k * lz; out[7] = zd1 * k * lz; out[8] = zd2 * k * lz;
}

function normalizeCols(m) {
  for (let c = 0; c < 3; c++) { const l = colLen(m, c) || 1; m[c * 3] /= l; m[c * 3 + 1] /= l; m[c * 3 + 2] /= l; }
}

// The parent frames for a bone: pp the parent's pose (4x4 at po), rp its rest (4x4 at ro), off the bone's rest offset
// Rp^-1 R (4x4 at oo). Fills Q, L, T and EXTRA.
function frames(pp, po, rp, ro, off, oo, flags) {
  for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) { P3[c * 3 + r] = pp[po + c * 4 + r]; B[c * 3 + r] = off[oo + c * 4 + r]; }
  // t: the rest head carried by the parent (Pp @ O translation)
  for (let r = 0; r < 3; r++) T[r] = pp[po + r] * off[oo + 12] + pp[po + 4 + r] * off[oo + 13] + pp[po + 8 + r] * off[oo + 14] + pp[po + 12 + r];
  if (flags.use_local_location !== false) mul3(L, P3, B); else L.set(P3);
  // p3: the parent's 3x3, or with Inherit Rotation off its rest orientation with the parent's column lengths
  if (flags.use_inherit_rotation === false) {
    const s0 = colLen(P3, 0), s1 = colLen(P3, 1), s2 = colLen(P3, 2);
    for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) A[c * 3 + r] = rp[ro + c * 4 + r] * [s0, s1, s2][c];
  } else A.set(P3);
  hasExtra = false;
  switch (flags.inherit_scale ?? 'FULL') {
    case 'FIX_SHEAR': mul3(Q, A, B); fixShear(Q, Q); break;
    case 'AVERAGE': { const k = Math.cbrt(det(P3)); fixShear(Q, A); normalizeCols(Q); for (let i = 0; i < 9; i++) Q[i] *= k; mul3(Q, Q, B); break; }
    case 'NONE': fixShear(Q, A); normalizeCols(Q); mul3(Q, Q, B); break;
    case 'NONE_LEGACY': Q.set(A); normalizeCols(Q); mul3(Q, Q, B); break;
    case 'ALIGNED': {
      fixShear(Q, A); normalizeCols(Q); mul3(Q, Q, B);
      fixShear(X2, P3);
      EXTRA[0] = colLen(X2, 0); EXTRA[1] = colLen(X2, 1); EXTRA[2] = colLen(X2, 2);
      hasExtra = true;
      break;
    }
    default: mul3(Q, A, B);
  }
}
const X2 = new Float64Array(9);

// Pose (4x4 into out at oo) from the parent's pose and the bone's basis (4x4 at bo); `connect` drops the location.
export function poseFromBasisInto(out, outo, pp, po, rp, ro, off, oo, flags, basis, bo, connect) {
  frames(pp, po, rp, ro, off, oo, flags);
  for (let c = 0; c < 3; c++) {
    const b0 = basis[bo + c * 4], b1 = basis[bo + c * 4 + 1], b2 = basis[bo + c * 4 + 2], e = hasExtra ? EXTRA[c] : 1;
    for (let r = 0; r < 3; r++) out[outo + c * 4 + r] = (Q[r] * b0 + Q[3 + r] * b1 + Q[6 + r] * b2) * e;
    out[outo + c * 4 + 3] = 0;
  }
  const l0 = connect ? 0 : basis[bo + 12], l1 = connect ? 0 : basis[bo + 13], l2 = connect ? 0 : basis[bo + 14];
  for (let r = 0; r < 3; r++) out[outo + 12 + r] = T[r] + L[r] * l0 + L[3 + r] * l1 + L[6 + r] * l2;
  out[outo + 15] = 1;
}

// The inverse: the basis (LOCAL space, location kept) of a pose matrix p (4x4), into out.
export function basisFromPoseInto(out, pp, po, rp, ro, off, oo, flags, p) {
  frames(pp, po, rp, ro, off, oo, flags);
  invert3(A, Q);
  for (let c = 0; c < 3; c++) {
    const p0 = p[c * 4], p1 = p[c * 4 + 1], p2 = p[c * 4 + 2], e = hasExtra ? 1 / EXTRA[c] : 1;
    for (let r = 0; r < 3; r++) out[c * 4 + r] = (A[r] * p0 + A[3 + r] * p1 + A[6 + r] * p2) * e;
    out[c * 4 + 3] = 0;
  }
  invert3(B, L);
  const d0 = p[12] - T[0], d1 = p[13] - T[1], d2 = p[14] - T[2];
  for (let r = 0; r < 3; r++) out[12 + r] = B[r] * d0 + B[3 + r] * d1 + B[6 + r] * d2;
  out[15] = 1;
  return out;
}

function invert3(out, m) {
  const a = m[0], b = m[1], c = m[2], d = m[3], e = m[4], f = m[5], g = m[6], h = m[7], i = m[8];
  const A0 = e * i - f * h, A1 = c * h - b * i, A2 = b * f - c * e;
  const det3 = a * A0 + d * A1 + g * A2, k = det3 ? 1 / det3 : 0;
  out[0] = A0 * k; out[1] = A1 * k; out[2] = A2 * k;
  out[3] = (f * g - d * i) * k; out[4] = (a * i - c * g) * k; out[5] = (c * d - a * f) * k;
  out[6] = (d * h - e * g) * k; out[7] = (b * g - a * h) * k; out[8] = (a * e - b * d) * k;
}

