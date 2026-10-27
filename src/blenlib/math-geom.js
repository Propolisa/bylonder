// Geometry functions (math_geom.cc) on [x, y, z] arrays.
import { dist_squared_to_line_segment_v2, line_point_factor_v2 } from './math-geom.gen.js';

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

export const len_squared_v3 = (a) => dot_v3(a, a);
export const madd = (a, b, f) => add_v3(a, mul_v3_fl(b, f));
export const negate_v3 = (a) => [-a[0], -a[1], -a[2]];
export const is_zero_v3 = (a) => a[0] === 0 && a[1] === 0 && a[2] === 0;
export const project_v3_v3v3 = (p, v) => mul_v3_fl(v, dot_v3(p, v) / dot_v3(v, v));
const safe_asin = (x) => Math.asin(Math.max(-1, Math.min(1, x)));
// angle_normalized_v3v3: more accurate than acos of the dot product.
export function angle_normalized_v3v3(a, b) {
  if (dot_v3(a, b) >= 0) return 2 * safe_asin(len_v3(sub_v3(a, b)) / 2);
  return Math.PI - 2 * safe_asin(len_v3(add_v3(a, b)) / 2);
}
export const angle_v3v3 = (a, b) => angle_normalized_v3v3(normalize_v3(a), normalize_v3(b));
export const project_plane_normalized_v3_v3v3 = (p, v_plane) => sub_v3(p, mul_v3_fl(v_plane, dot_v3(p, v_plane)));
// The angle from v1 to v2 around `axis`, 0 to 2 pi.
export function angle_signed_on_axis_v3v3_v3(v1, v2, axis) {
  const v1_proj = project_plane_normalized_v3_v3v3(v1, axis), v2_proj = project_plane_normalized_v3_v3v3(v2, axis);
  const angle = angle_v3v3(v1_proj, v2_proj);
  return dot_v3(cross_v3(v2_proj, v1_proj), axis) < 0 ? Math.PI * 2 - angle : angle;
}
export const angle_signed_on_axis_v3v3v3_v3 = (v1, v2, v3, axis) => angle_signed_on_axis_v3v3_v3(sub_v3(v1, v2), sub_v3(v3, v2), axis);
// The unit normals of a triangle and of a quad's diagonals (zero when degenerate).
export const normal_tri_v3 = (v1, v2, v3) => normalize_v3(cross_v3(sub_v3(v1, v2), sub_v3(v2, v3)));
export const normal_quad_v3 = (v1, v2, v3, v4) => normalize_v3(cross_v3(sub_v3(v1, v3), sub_v3(v2, v4)));
// One step of Newell's method for a polygon normal.
export const add_newell_cross_v3_v3v3 = (n, a, b) => [
  n[0] + (a[1] - b[1]) * (a[2] + b[2]),
  n[1] + (a[2] - b[2]) * (a[0] + b[0]),
  n[2] + (a[0] - b[0]) * (a[1] + b[1]),
];

// The factor along the ray where it meets the plane, or null when parallel.
export function isect_ray_plane_v3_factor(ray_origin, ray_direction, plane_co, plane_no) {
  const dot = dot_v3(plane_no, ray_direction);
  return dot === 0 ? null : -dot_v3(plane_no, sub_v3(ray_origin, plane_co)) / dot;
}

// The factor along ray a of its closest point to ray b, or null when parallel.
export function isect_ray_ray_v3(origin_a, direction_a, origin_b, direction_b) {
  const n = cross_v3(direction_b, direction_a), nlen = len_squared_v3(n);
  if (nlen < 1.1754944e-38) return null;
  const c = sub_v3(n, sub_v3(origin_b, origin_a));
  return dot_v3(cross_v3(c, direction_b), n) / nlen;
}

// The angle at v2 between v1 and v3; angle_on_axis measures it projected on the plane across `axis`.
export const angle_v3v3v3 = (v1, v2, v3) => angle_v3v3(sub_v3(v1, v2), sub_v3(v3, v2));
export const angle_on_axis_v3v3v3_v3 = (v1, v2, v3, axis) => angle_v3v3(project_plane_normalized_v3_v3v3(sub_v3(v1, v2), axis), project_plane_normalized_v3_v3v3(sub_v3(v3, v2), axis));
export const interpf = (target, origin, t) => t * target + (1 - t) * origin;

// interp_weights_poly_v2: mean value weights of co in the polygon v, written to w.
// port-override: Blender steps a float pointer back across rows (`v[n - 1] - 2` for v[n - 2]); here rows are indexed.
export function interp_weights_poly_v2(w, v, n, co) {
  let max_value = 0;
  for (let i = 0; i < n; i++) max_value = Math.max(max_value, Math.abs(Math.fround(v[i][0] - co[0])), Math.abs(Math.fround(v[i][1] - co[1])));
  const eps = Math.fround(Math.fround(16 * 1.1920929e-7) * max_value);
  const eps_sq = Math.fround(eps * eps);
  const dir = (p) => { const d = [p[0] - co[0], p[1] - co[1]]; return { d, len: Math.sqrt(d[0] * d[0] + d[1] * d[1]) }; };
  const half_tan = (a, b) => {
    const area = a.d[0] * b.d[1] - a.d[1] * b.d[0];
    if (area === 0) return 0;
    const result = (a.len * b.len - (a.d[0] * b.d[0] + a.d[1] * b.d[1])) / area;
    return Number.isFinite(result) ? result : 0;
  };
  let i_curr = n - 1, i_next = 0, ix = 0, totweight = 0;
  let d_curr = dir(v[n - 2]), d_next = dir(v[n - 1]);
  let ht_prev = half_tan(d_curr, d_next);
  while (i_next < n) {
    if (d_next.len < eps) { ix = 1; break; }
    if (dist_squared_to_line_segment_v2(co, v[i_curr], v[i_next]) < eps_sq) { ix = 2; break; }
    d_curr = d_next;
    d_next = dir(v[i_next]);
    const ht = half_tan(d_curr, d_next);
    w[i_curr] = d_curr.len === 0 ? 0 : Math.fround((ht_prev + ht) / d_curr.len);
    totweight = Math.fround(totweight + w[i_curr]);
    i_curr = i_next++;
    ht_prev = ht;
  }
  if (ix) {
    w.fill(0, 0, n);
    if (ix === 1) w[i_curr] = 1;
    else {
      const fac = Math.min(Math.max(line_point_factor_v2(co, v[i_curr], v[i_next]), 0), 1);
      w[i_curr] = Math.fround(1 - fac);
      w[i_next] = fac;
    }
  } else if (totweight !== 0) for (let i = 0; i < n; i++) w[i] = Math.fround(w[i] / totweight);
}

export * from './math-geom.gen.js';
