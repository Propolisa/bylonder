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
