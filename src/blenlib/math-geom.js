// Geometry functions (math_geom.cc) on [x, y, z] arrays.
export const sub_v3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add_v3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const mul_v3_fl = (a, f) => [a[0] * f, a[1] * f, a[2] * f];
export const dot_v3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross_v3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len_v3 = (a) => Math.hypot(a[0], a[1], a[2]);
export const mid_v3 = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
export const interp_v3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export function normalize_v3(a) {
  const len = len_v3(a);
  return len ? mul_v3_fl(a, 1 / len) : [0, 0, 0];
}

// Factor of `p` projected on the line l1 to l2 (0 at l1, 1 at l2).
export function line_point_factor_v3(p, l1, l2) {
  const u = sub_v3(l2, l1), dot = dot_v3(u, u);
  return dot ? dot_v3(u, sub_v3(p, l1)) / dot : 0;
}

// The intersection of the line l1 to l2 with a plane, or null when they are parallel.
export function isect_line_plane_v3(l1, l2, plane_co, plane_no) {
  const u = sub_v3(l2, l1), dot = dot_v3(plane_no, u);
  if (Math.abs(dot) <= 1.1920929e-7) return null;
  return add_v3(l1, mul_v3_fl(u, -dot_v3(plane_no, sub_v3(l1, plane_co)) / dot));
}

// The closest points between the lines v1 to v2 and v3 to v4: [count, i1, i2], count 0 when either line has no
// length or they are parallel, 1 when they cross, 2 otherwise.
export function isect_line_line_epsilon_v3(v1, v2, v3, v4, epsilon) {
  let c = sub_v3(v3, v1), a = sub_v3(v2, v1), b = sub_v3(v4, v3);
  let ab = cross_v3(a, b);
  const d = dot_v3(c, ab), div = dot_v3(ab, ab);
  if (div === 0) return [0];
  if (Math.abs(d) <= epsilon) {
    const i1 = add_v3(v1, mul_v3_fl(a, dot_v3(cross_v3(c, b), ab) / div));
    return [1, i1, i1];
  }
  const n = cross_v3(a, b);
  const t0 = sub_v3(v1, v3), t = mul_v3_fl(n, dot_v3(t0, n) / dot_v3(n, n));
  const v3t = add_v3(v3, t), v4t = add_v3(v4, t);
  c = sub_v3(v3t, v1);
  b = sub_v3(v4t, v3t);
  ab = cross_v3(a, b);
  const i1 = add_v3(v1, mul_v3_fl(a, dot_v3(cross_v3(c, b), ab) / dot_v3(ab, ab)));
  return [2, i1, sub_v3(i1, t)];
}
