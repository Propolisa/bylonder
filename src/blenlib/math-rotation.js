import { cross_v3, len_v3, dot_v3, normalize_v3, ortho_v3_v3 } from './math-geom.js';
// From math_rotation_c.cc. Single precision like Blender's float math.
const f32 = Math.fround;

// sin and cos of 2 pi * numerator / denominator, exactly symmetric around the circle (see #87779).
export function sin_cos_from_fraction(numerator, denominator) {
  numerator *= 8;
  const octant = Math.trunc(numerator / denominator);
  denominator *= 8;
  let swap = false, cos_sign = 1;
  switch (octant) {
    case 1: case 2: numerator = denominator / 4 - numerator; swap = true; break;
    case 3: case 4: numerator = denominator / 2 - numerator; cos_sign = -1; break;
    case 5: case 6: numerator = numerator - (denominator * 3) / 4; swap = true; cos_sign = -1; break;
    case 7: numerator = numerator - denominator; break;
  }
  const angle = f32(f32(2 * Math.PI) * f32(f32(numerator) / f32(denominator)));
  const s = f32(Math.sin(angle)), c = f32(Math.cos(angle));
  // With the result pointers swapped, sin lands in cos and cos (signed) in sin.
  return swap ? [f32(c * cos_sign), s] : [s, f32(c * cos_sign)];
}

// Rotation about a unit axis, right handed (a positive angle turns X towards Y about Z).
export function axis_angle_normalized_to_mat3([x, y, z], angle) {
  const c = Math.cos(angle), s = Math.sin(angle), t = 1 - c;
  return [
    [t * x * x + c, t * x * y + s * z, t * x * z - s * y],
    [t * x * y - s * z, t * y * y + c, t * y * z + s * x],
    [t * x * z + s * y, t * y * z - s * x, t * z * z + c],
  ];
}

// port-override: Blender's jumps back with a goto (the converter has none) for the half turn about an axis
// orthogonal to v1.
export function rotation_between_vecs_to_mat3(v1, v2) {
  const axis = cross_v3(v1, v2), angle_sin = len_v3(axis), angle_cos = dot_v3(v1, v2);
  if (angle_sin > 1.1920929e-7) return axis_angle_normalized_to_mat3(normalize_v3(axis), Math.atan2(angle_sin, angle_cos));
  if (angle_cos > 0) return [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  return axis_angle_normalized_to_mat3(normalize_v3(ortho_v3_v3(v1)), Math.PI);
}

export * from './math-rotation.gen.js';
