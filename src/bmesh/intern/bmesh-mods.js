// Mid-level topology changes (bmesh_mods.cc).
import { bmesh_kernel_join_edge_kill_vert, bmesh_kernel_loop_reverse, BM_faces_join, bmesh_kernel_join_vert_kill_edge, bmesh_kernel_split_edge_make_vert, bmesh_kernel_split_face_make_edge, BM_elem_attrs_copy } from './bmesh-core.js';
import { BM_edge_other_vert, BM_loop_is_adjacent } from './bmesh-query.js';

export const BM_edge_collapse = (bm, e_kill, v_kill, do_del, kill_degenerate_faces) =>
  bmesh_kernel_join_vert_kill_edge(bm, e_kill, v_kill, do_del, true, kill_degenerate_faces);

export function BM_edge_verts_swap(bm, e) {
  const { e: E } = bm;
  [E.v1[e], E.v2[e]] = [E.v2[e], E.v1[e]];
  [E.v1_disk_next[e], E.v2_disk_next[e]] = [E.v2_disk_next[e], E.v1_disk_next[e]];
  [E.v1_disk_prev[e], E.v2_disk_prev[e]] = [E.v2_disk_prev[e], E.v1_disk_prev[e]];
}

// Loop custom data of `dst` as src[0] * w[0] + src[1] * w[1] (CustomData_bmesh_interp for two sources).
function loopDataInterp(bm, src, w, dst) {
  for (const layer of bm.l.layers) {
    const n = layer.size, d = layer.data;
    for (let k = 0; k < n; k++) d[dst * n + k] = d[src[0] * n + k] * w[0] + d[src[1] * n + k] * w[1];
  }
}

// BM_data_interp_face_vert_edge: loop data at the new vert `v` on edge `e`, between v_src_1's loop and the next.
function BM_data_interp_face_vert_edge(bm, v_src_1, v, e, fac) {
  const { l } = bm, first = bm.e.l[e];
  if (first < 0 || !bm.l.layers.length) return;
  let it = first;
  do {
    let l_v1 = -1, l_v = -1, l_v2 = -1;
    if (l.v[it] === v_src_1) { l_v1 = it; l_v = l.next[l_v1]; l_v2 = l.next[l_v]; }
    else if (l.v[it] === v) { l_v1 = l.next[it]; l_v = it; l_v2 = l.prev[it]; }
    if (l_v1 < 0 || l_v2 < 0) return;
    loopDataInterp(bm, [l_v1, l_v2], [fac, 1 - fac], l_v);
  } while ((it = l.radial_next[it]) !== first);
}

// BM_edge_split: a new vert on e at `fac` from v towards the other end. Returns [v_new, e_new].
export function BM_edge_split(bm, e, v, fac) {
  const v_other = BM_edge_other_vert(bm, e, v);
  const [v_new, e_new] = bmesh_kernel_split_edge_make_vert(bm, v, e);
  const co = bm.v.co;
  for (let a = 0; a < 3; a++) co[v_new * 3 + a] = co[v * 3 + a] + (co[v_other * 3 + a] - co[v * 3 + a]) * fac;
  bm.e.hflag[e_new] = bm.e.hflag[e];
  BM_elem_attrs_copy(bm.e, e, e_new);
  BM_data_interp_face_vert_edge(bm, v_other, v_new, e, fac);
  return [v_new, e_new];
}

// BM_face_split: cuts f between the verts of l_a and l_b. Returns [f_new, l_new], or null for adjacent loops.
export function BM_face_split(bm, f, l_a, l_b, example = -1, no_double = false) {
  if (BM_loop_is_adjacent(bm, l_a, l_b) || bm.l.f[l_a] !== f || bm.l.f[l_b] !== f) return null;
  return bmesh_kernel_split_face_make_edge(bm, f, l_a, l_b, example, no_double);
}

// BM_faces_join_pair: joins the two faces of an edge, first turning one so their windings agree.
export function BM_faces_join_pair(bm, l_a, l_b, do_del) {
  if (bm.l.v[l_a] === bm.l.v[l_b]) bmesh_kernel_loop_reverse(bm, bm.l.f[l_b]);
  return BM_faces_join(bm, [bm.l.f[l_a], bm.l.f[l_b]], do_del, false)[0];
}

// BM_vert_collapse_edge: removes a vert with two edges, keeping faces; the corners on e_kill take the data of the
// corner they collapse onto.
export function BM_vert_collapse_edge(bm, e_kill, v_kill, do_del, kill_degenerate_faces, kill_duplicate_faces) {
  const { l } = bm, tv = BM_edge_other_vert(bm, e_kill, v_kill), first = bm.e.l[e_kill];
  if (first >= 0) {
    let it = first;
    do {
      const kv = l.next[it];
      if (l.v[it] === tv && l.v[kv] === v_kill) for (const layer of l.layers) layer.data.copyWithin(kv * layer.size, it * layer.size, it * layer.size + layer.size);
    } while ((it = l.radial_next[it]) !== first);
  }
  return bmesh_kernel_join_edge_kill_vert(bm, e_kill, v_kill, do_del, true, kill_degenerate_faces, kill_duplicate_faces);
}
