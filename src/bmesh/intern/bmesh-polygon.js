// Face geometry (bmesh_polygon.cc).
import { bmesh_kernel_loop_reverse } from './bmesh-core.js';
import { add_v3, sub_v3, mul_v3_fl, dot_v3, len_v3, len_squared_v3, normalize_v3, is_zero_v3, project_plane_normalized_v3_v3v3, angle_signed_on_axis_v3v3_v3, normal_tri_v3, normal_quad_v3, add_newell_cross_v3_v3v3 } from '../../blenlib/math-geom.js';

// BM_face_calc_normal: the unit normal by Newell's method.
export function BM_face_calc_normal(bm, f) {
  let n = [0, 0, 0];
  for (const lp of loopsOf(bm, f)) n = add_newell_cross_v3_v3v3(n, coOf(bm, bm.l.v[lp]), coOf(bm, bm.l.v[bm.l.next[lp]]));
  return normalize_v3(n);
}

// BM_face_calc_normal into f->no; returns the face area times two before normalizing.
export function BM_face_normal_update(bm, f) {
  const { l } = bm, co = bm.v.co;
  const first = bm.f.l_first[f];
  let nx = 0, ny = 0, nz = 0, it = first;
  do {
    const a = l.v[it] * 3, b = l.v[l.next[it]] * 3;
    nx += (co[a + 1] - co[b + 1]) * (co[a + 2] + co[b + 2]);
    ny += (co[a + 2] - co[b + 2]) * (co[a] + co[b]);
    nz += (co[a] - co[b]) * (co[a + 1] + co[b + 1]);
  } while ((it = l.next[it]) !== first);
  const len = Math.hypot(nx, ny, nz);
  const s = len ? 1 / len : 0;
  bm.f.no[f * 3] = nx * s;
  bm.f.no[f * 3 + 1] = ny * s;
  bm.f.no[f * 3 + 2] = nz * s;
  return len;
}

export function BM_face_normal_flip(bm, f) {
  bmesh_kernel_loop_reverse(bm, f);
  for (let a = 0; a < 3; a++) bm.f.no[f * 3 + a] = -bm.f.no[f * 3 + a];
}

const coOf = (bm, v) => [bm.v.co[v * 3], bm.v.co[v * 3 + 1], bm.v.co[v * 3 + 2]];
const loopsOf = (bm, f) => { const out = [], first = bm.f.l_first[f]; let l = first; do out.push(l); while ((l = bm.l.next[l]) !== first); return out; };

export function BM_face_calc_area(bm, f) {
  let n = [0, 0, 0];
  for (const l of loopsOf(bm, f)) n = add_newell_cross_v3_v3v3(n, coOf(bm, bm.l.v[l]), coOf(bm, bm.l.v[bm.l.next[l]]));
  return len_v3(n) * 0.5;
}

// The vertex average weighted by the lengths of the two edges at each corner.
export function BM_face_calc_center_median_weighted(bm, f) {
  const { l } = bm, edgeLength = (e) => len_v3(sub_v3(coOf(bm, bm.e.v1[e]), coOf(bm, bm.e.v2[e])));
  let cent = [0, 0, 0], totw = 0, w_prev = edgeLength(l.e[l.prev[bm.f.l_first[f]]]);
  for (const lp of loopsOf(bm, f)) {
    const w_curr = edgeLength(l.e[lp]), w = w_curr + w_prev;
    cent = add_v3(cent, mul_v3_fl(coOf(bm, l.v[lp]), w));
    totw += w;
    w_prev = w_curr;
  }
  return totw ? mul_v3_fl(cent, 1 / totw) : cent;
}

// BM_verts_calc_normal_from_cloud_ex: { normal, center, index_tangent } for unordered verts.
export function BM_verts_calc_normal_from_cloud_ex(bm, verts) {
  const cos = verts.map((v) => coOf(bm, v)), len = cos.length;
  const center = cos.reduce((c, co) => add_v3(c, mul_v3_fl(co, 1 / len)), [0, 0, 0]);
  const farthest = (dist_sq) => { let best = -1, max = -1; cos.forEach((co, i) => { const d = dist_sq(co, i); if (d !== null && !(d <= max)) { best = i; max = d; } }); return best; };
  let co_a_index = farthest((co) => len_squared_v3(sub_v3(co, center)));
  const dir_a = normalize_v3(sub_v3(cos[co_a_index], center));
  const co_b_index = farthest((co, i) => (i === co_a_index ? null : len_squared_v3(project_plane_normalized_v3_v3v3(sub_v3(co, center), dir_a))));
  const co_a = cos[co_a_index], co_b = cos[co_b_index];
  let normal;
  if (len <= 3) normal = normal_tri_v3(center, co_a, co_b);
  else {
    const dir_b = normalize_v3(project_plane_normalized_v3_v3v3(sub_v3(co_b, center), dir_a));
    let a_opposite = -1, b_opposite = -1, dot_a_min = Infinity, dot_b_min = Infinity;
    cos.forEach((co, i) => {
      if (i !== co_a_index) { const d = dot_v3(dir_a, co); if (d < dot_a_min || a_opposite < 0) { dot_a_min = d; a_opposite = i; } }
      if (i !== co_b_index) { const d = dot_v3(dir_b, co); if (d < dot_b_min || b_opposite < 0) { dot_b_min = d; b_opposite = i; } }
    });
    normal = normal_quad_v3(co_a, co_b, cos[a_opposite], cos[b_opposite]);
    if (!is_zero_v3(normal)) {
      // Refine by accumulating a normal over all verts in radial order around the first one.
      const angles = cos.map((co) => { const a = angle_signed_on_axis_v3v3_v3(dir_a, sub_v3(co, center), normal); return Number.isFinite(a) ? a : 0; });
      const order = cos.map((_, i) => i).sort((a, b) => angles[b] - angles[a]);
      let refine = [0, 0, 0], v_prev = cos[order.at(-1)];
      for (const i of order) { refine = add_newell_cross_v3_v3v3(refine, v_prev, cos[i]); v_prev = cos[i]; }
      refine = normalize_v3(refine);
      if (!is_zero_v3(refine)) {
        co_a_index = farthest((co) => len_squared_v3(project_plane_normalized_v3_v3v3(sub_v3(co, center), refine)));
        normal = refine;
      }
    }
  }
  return { normal, center, index_tangent: co_a_index };
}
