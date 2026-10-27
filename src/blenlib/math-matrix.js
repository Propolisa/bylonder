// 4x4 matrices as four columns, like Blender's float[4][4] (m[col][row]).
export const unit_m4 = () => [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];
export const mul_m4_v3 = (m, [x, y, z]) => [0, 1, 2].map((r) => m[0][r] * x + m[1][r] * y + m[2][r] * z + m[3][r]);
export const mul_m4_v4 = (m, [x, y, z, w]) => [0, 1, 2, 3].map((r) => m[0][r] * x + m[1][r] * y + m[2][r] * z + m[3][r] * w);
export const mul_mat3_m4_v3 = (m, [x, y, z]) => [0, 1, 2].map((r) => m[0][r] * x + m[1][r] * y + m[2][r] * z);

// The inverse, or null when m is singular.
export function invert_m4_m4(m) {
  const [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = m.flat();
  const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12, b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
  const det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!det) return null;
  const d = 1 / det;
  return [
    [(a11 * b11 - a12 * b10 + a13 * b09) * d, (a02 * b10 - a01 * b11 - a03 * b09) * d, (a31 * b05 - a32 * b04 + a33 * b03) * d, (a22 * b04 - a21 * b05 - a23 * b03) * d],
    [(a12 * b08 - a10 * b11 - a13 * b07) * d, (a00 * b11 - a02 * b08 + a03 * b07) * d, (a32 * b02 - a30 * b05 - a33 * b01) * d, (a20 * b05 - a22 * b02 + a23 * b01) * d],
    [(a10 * b10 - a11 * b08 + a13 * b06) * d, (a01 * b08 - a00 * b10 - a03 * b06) * d, (a30 * b04 - a31 * b02 + a33 * b00) * d, (a21 * b02 - a20 * b04 - a23 * b00) * d],
    [(a11 * b07 - a10 * b09 - a12 * b06) * d, (a00 * b09 - a01 * b07 + a02 * b06) * d, (a31 * b01 - a30 * b03 - a32 * b00) * d, (a20 * b03 - a21 * b01 + a22 * b00) * d],
  ];
}

// 3x3 matrices as three columns, like Blender's float[3][3] (m[col][row]).
export const unit_m3 = () => [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
export const mul_m3_v3 = (m, [x, y, z]) => [0, 1, 2].map((r) => m[0][r] * x + m[1][r] * y + m[2][r] * z);
export const mul_m3_m3m3 = (a, b) => b.map((column) => mul_m3_v3(a, column));
export const transpose_m3 = (m) => [0, 1, 2].map((c) => [m[0][c], m[1][c], m[2][c]]);
export const size_to_mat3 = ([x, y, z]) => [[x, 0, 0], [0, y, 0], [0, 0, z]];
