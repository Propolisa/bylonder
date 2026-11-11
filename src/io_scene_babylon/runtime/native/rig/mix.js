// @ts-nocheck
// SPDX-License-Identifier: MIT OR Apache-2.0
// From babylon-blender-rig (scripts/native-rig.mjs).
// Copy Transforms' mix modes (specs/copy_transforms.md) in place: out = mix(O, T) for owner O and target T, with
// split(M) = (translation, normalized columns with X negated for a negative determinant, signed column lengths) and
// compose(t, R, s) = [R diag(s) | t]. Scratch only; `out` may be a reused matrix.
const RO = new Float64Array(9), RT = new Float64Array(9), R = new Float64Array(9), SO = new Float64Array(3), ST = new Float64Array(3);

function split(m, r, s) {
  for (let c = 0; c < 3; c++) {
    const x = m[c * 4], y = m[c * 4 + 1], z = m[c * 4 + 2], l = Math.sqrt(x * x + y * y + z * z), k = l ? 1 / l : 1;
    r[c * 3] = x * k; r[c * 3 + 1] = y * k; r[c * 3 + 2] = z * k; s[c] = l;
  }
  const det = r[0] * (r[4] * r[8] - r[5] * r[7]) - r[3] * (r[1] * r[8] - r[2] * r[7]) + r[6] * (r[1] * r[5] - r[2] * r[4]);
  if (det < 0) { s[0] = -s[0]; r[0] = -r[0]; r[1] = -r[1]; r[2] = -r[2]; }
}

function mul3(out, a, b) {
  for (let c = 0; c < 3; c++) {
    const b0 = b[c * 3], b1 = b[c * 3 + 1], b2 = b[c * 3 + 2];
    for (let k = 0; k < 3; k++) out[c * 3 + k] = a[k] * b0 + a[3 + k] * b1 + a[6 + k] * b2;
  }
}

function compose(out, tx, ty, tz, r, sa, sb) {
  for (let c = 0; c < 3; c++) {
    const k = sa[c] * sb[c];
    out[c * 4] = r[c * 3] * k; out[c * 4 + 1] = r[c * 3 + 1] * k; out[c * 4 + 2] = r[c * 3 + 2] * k; out[c * 4 + 3] = 0;
  }
  out[12] = tx; out[13] = ty; out[14] = tz; out[15] = 1;
  return out;
}

const point = (m, x, y, z, i) => m[i] * x + m[4 + i] * y + m[8 + i] * z + m[12 + i];

function full(out, a, b) {
  const t = new Float64Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) t[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  out.set(t);
  return out;
}

export function mixInto(out, mode, O, T) {
  switch (mode) {
    case 'REPLACE': out.set(T); return out;
    case 'BEFORE_FULL': return full(out, T, O);
    case 'AFTER_FULL': return full(out, O, T);
  }
  split(O, RO, SO); split(T, RT, ST);
  switch (mode) {
    case 'BEFORE': mul3(R, RT, RO); return compose(out, point(T, O[12], O[13], O[14], 0), point(T, O[12], O[13], O[14], 1), point(T, O[12], O[13], O[14], 2), R, ST, SO);
    case 'AFTER': mul3(R, RO, RT); return compose(out, point(O, T[12], T[13], T[14], 0), point(O, T[12], T[13], T[14], 1), point(O, T[12], T[13], T[14], 2), R, SO, ST);
    case 'BEFORE_SPLIT': mul3(R, RT, RO); return compose(out, T[12] + O[12], T[13] + O[13], T[14] + O[14], R, ST, SO);
    case 'AFTER_SPLIT': mul3(R, RO, RT); return compose(out, O[12] + T[12], O[13] + T[13], O[14] + T[14], R, SO, ST);
    default: out.set(T); return out;
  }
}
