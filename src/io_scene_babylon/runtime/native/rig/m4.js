// @ts-nocheck
// SPDX-License-Identifier: MIT OR Apache-2.0
// From babylon-blender-rig (scripts/native-rig.mjs).
// In-place 4x4 kernels on (array, offset) pairs: column-major, column vectors, as src/math.js. No allocation.

export function copy16(out, oo, a, ao) {
  for (let i = 0; i < 16; i++) out[oo + i] = a[ao + i];
}

export function setIdentity(out, oo) {
  for (let i = 0; i < 16; i++) out[oo + i] = 0;
  out[oo] = out[oo + 5] = out[oo + 10] = out[oo + 15] = 1;
}

// out = a @ b for affine a, b (last row 0 0 0 1). out may alias a or b.
export function mulAffine(out, oo, a, ao, b, bo) {
  const a0 = a[ao], a1 = a[ao + 1], a2 = a[ao + 2], a4 = a[ao + 4], a5 = a[ao + 5], a6 = a[ao + 6];
  const a8 = a[ao + 8], a9 = a[ao + 9], a10 = a[ao + 10], a12 = a[ao + 12], a13 = a[ao + 13], a14 = a[ao + 14];
  const b0 = b[bo], b1 = b[bo + 1], b2 = b[bo + 2], b4 = b[bo + 4], b5 = b[bo + 5], b6 = b[bo + 6];
  const b8 = b[bo + 8], b9 = b[bo + 9], b10 = b[bo + 10], b12 = b[bo + 12], b13 = b[bo + 13], b14 = b[bo + 14];
  out[oo] = a0 * b0 + a4 * b1 + a8 * b2;
  out[oo + 1] = a1 * b0 + a5 * b1 + a9 * b2;
  out[oo + 2] = a2 * b0 + a6 * b1 + a10 * b2;
  out[oo + 3] = 0;
  out[oo + 4] = a0 * b4 + a4 * b5 + a8 * b6;
  out[oo + 5] = a1 * b4 + a5 * b5 + a9 * b6;
  out[oo + 6] = a2 * b4 + a6 * b5 + a10 * b6;
  out[oo + 7] = 0;
  out[oo + 8] = a0 * b8 + a4 * b9 + a8 * b10;
  out[oo + 9] = a1 * b8 + a5 * b9 + a9 * b10;
  out[oo + 10] = a2 * b8 + a6 * b9 + a10 * b10;
  out[oo + 11] = 0;
  out[oo + 12] = a0 * b12 + a4 * b13 + a8 * b14 + a12;
  out[oo + 13] = a1 * b12 + a5 * b13 + a9 * b14 + a13;
  out[oo + 14] = a2 * b12 + a6 * b13 + a10 * b14 + a14;
  out[oo + 15] = 1;
}

// out = a @ b for general 4x4 matrices. out may alias a or b.
export function mul4(out, oo, a, ao, b, bo) {
  const t = TMP;
  for (let c = 0; c < 4; c++) {
    const b0 = b[bo + c * 4], b1 = b[bo + c * 4 + 1], b2 = b[bo + c * 4 + 2], b3 = b[bo + c * 4 + 3];
    for (let r = 0; r < 4; r++) t[c * 4 + r] = a[ao + r] * b0 + a[ao + 4 + r] * b1 + a[ao + 8 + r] * b2 + a[ao + 12 + r] * b3;
  }
  for (let i = 0; i < 16; i++) out[oo + i] = t[i];
}
const TMP = new Float64Array(16);

// Inverse of an affine matrix. out may alias a. A singular 3x3 gives the identity (as src/math.js invert).
export function invertAffine(out, oo, a, ao) {
  const m0 = a[ao], m1 = a[ao + 1], m2 = a[ao + 2], m4 = a[ao + 4], m5 = a[ao + 5], m6 = a[ao + 6];
  const m8 = a[ao + 8], m9 = a[ao + 9], m10 = a[ao + 10], tx = a[ao + 12], ty = a[ao + 13], tz = a[ao + 14];
  const c0 = m5 * m10 - m6 * m9, c1 = m6 * m8 - m4 * m10, c2 = m4 * m9 - m5 * m8;
  const det = m0 * c0 + m1 * c1 + m2 * c2;
  if (!det) { setIdentity(out, oo); return; }
  const d = 1 / det;
  const i0 = c0 * d, i4 = c1 * d, i8 = c2 * d;
  const i1 = (m2 * m9 - m1 * m10) * d, i5 = (m0 * m10 - m2 * m8) * d, i9 = (m1 * m8 - m0 * m9) * d;
  const i2 = (m1 * m6 - m2 * m5) * d, i6 = (m2 * m4 - m0 * m6) * d, i10 = (m0 * m5 - m1 * m4) * d;
  out[oo] = i0; out[oo + 1] = i1; out[oo + 2] = i2; out[oo + 3] = 0;
  out[oo + 4] = i4; out[oo + 5] = i5; out[oo + 6] = i6; out[oo + 7] = 0;
  out[oo + 8] = i8; out[oo + 9] = i9; out[oo + 10] = i10; out[oo + 11] = 0;
  out[oo + 12] = -(i0 * tx + i4 * ty + i8 * tz);
  out[oo + 13] = -(i1 * tx + i5 * ty + i9 * tz);
  out[oo + 14] = -(i2 * tx + i6 * ty + i10 * tz);
  out[oo + 15] = 1;
}

export const isIdentity = (a, ao) => {
  for (let i = 0; i < 16; i++) if (a[ao + i] !== (i % 5 === 0 ? 1 : 0)) return false;
  return true;
};

// Blender's rotation modes as small integers (the basis kernels switch on them).
export const ROT = { QUATERNION: 0, AXIS_ANGLE: 1, XYZ: 2, XZY: 3, YXZ: 4, YZX: 5, ZXY: 6, ZYX: 7 };
export const ROT_NAMES = Object.keys(ROT);

// Basis matrix T(loc) @ Rot @ diag(scale) into out. rot holds 4 values per bone: a quaternion (w, x, y, z), an
// axis angle (angle, x, y, z) or Euler angles (x, y, z, unused) in radians; mode from ROT.
export function composeBasis(out, oo, loc, lo, rot, ro, mode, scale, so) {
  let r00, r01, r02, r10, r11, r12, r20, r21, r22;
  if (mode <= 1) {
    let w, x, y, z;
    if (mode === 0) { w = rot[ro]; x = rot[ro + 1]; y = rot[ro + 2]; z = rot[ro + 3]; }
    else {
      const ax = rot[ro + 1], ay = rot[ro + 2], az = rot[ro + 3], l = Math.sqrt(ax * ax + ay * ay + az * az);
      const h = rot[ro] / 2, s = l ? Math.sin(h) / l : 0;
      w = Math.cos(h); x = ax * s; y = ay * s; z = az * s;
      if (!l) w = 1;
    }
    const n = Math.sqrt(w * w + x * x + y * y + z * z) || 1;
    w /= n; x /= n; y /= n; z /= n;
    r00 = 1 - 2 * (y * y + z * z); r01 = 2 * (x * y - w * z); r02 = 2 * (x * z + w * y);
    r10 = 2 * (x * y + w * z); r11 = 1 - 2 * (x * x + z * z); r12 = 2 * (y * z - w * x);
    r20 = 2 * (x * z - w * y); r21 = 2 * (y * z + w * x); r22 = 1 - 2 * (x * x + y * y);
  } else {
    // Euler: R = R_last @ R_mid @ R_first for the order's letters, each R_a about its axis.
    const order = EULER_AXES[mode];
    let m = E0;
    m[0] = 1; m[1] = 0; m[2] = 0; m[3] = 0; m[4] = 1; m[5] = 0; m[6] = 0; m[7] = 0; m[8] = 1;
    for (let k = 0; k < 3; k++) {
      const a = order[k], ang = rot[ro + a], c = Math.cos(ang), s = Math.sin(ang);
      // m = R_a @ m (row-major 3x3 m[r*3+c])
      const i = (a + 1) % 3, j = (a + 2) % 3;
      for (let col = 0; col < 3; col++) {
        const vi = m[i * 3 + col], vj = m[j * 3 + col];
        m[i * 3 + col] = c * vi - s * vj;
        m[j * 3 + col] = s * vi + c * vj;
      }
    }
    r00 = m[0]; r01 = m[1]; r02 = m[2]; r10 = m[3]; r11 = m[4]; r12 = m[5]; r20 = m[6]; r21 = m[7]; r22 = m[8];
  }
  const sx = scale[so], sy = scale[so + 1], sz = scale[so + 2];
  out[oo] = r00 * sx; out[oo + 1] = r10 * sx; out[oo + 2] = r20 * sx; out[oo + 3] = 0;
  out[oo + 4] = r01 * sy; out[oo + 5] = r11 * sy; out[oo + 6] = r21 * sy; out[oo + 7] = 0;
  out[oo + 8] = r02 * sz; out[oo + 9] = r12 * sz; out[oo + 10] = r22 * sz; out[oo + 11] = 0;
  out[oo + 12] = loc[lo]; out[oo + 13] = loc[lo + 1]; out[oo + 14] = loc[lo + 2]; out[oo + 15] = 1;
}
const E0 = new Float64Array(9);
const EULER_AXES = [null, null, [0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
