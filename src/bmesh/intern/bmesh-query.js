// Queries (bmesh_query.cc, bmesh_query_inline.hh).
import { bmesh_disk_edge_next } from './bmesh-structure.js';

export const BM_vert_in_edge = (bm, e, v) => bm.e.v1[e] === v || bm.e.v2[e] === v;
export const BM_edge_other_vert = (bm, e, v) => (bm.e.v1[e] === v ? bm.e.v2[e] : bm.e.v1[e]);
export const BM_FACE_FIRST_LOOP = (bm, f) => bm.f.l_first[f];

export const BM_edge_is_wire = (bm, e) => bm.e.l[e] < 0;
export function BM_edge_is_manifold(bm, e) {
  const l = bm.e.l[e];
  return l >= 0 && bm.l.radial_next[l] !== l && bm.l.radial_next[bm.l.radial_next[l]] === l;
}
export function BM_edge_is_boundary(bm, e) {
  const l = bm.e.l[e];
  return l >= 0 && bm.l.radial_next[l] === l;
}

export function BM_edge_face_count_is_over(bm, e, n) {
  const first = bm.e.l[e];
  if (first < 0) return n < 0;
  let count = 0, l = first;
  do if (++count > n) return true; while ((l = bm.l.radial_next[l]) !== first);
  return false;
}

export function BM_edge_exists(bm, v_a, v_b) {
  const e_a = bm.v.e[v_a], e_b = bm.v.e[v_b];
  if (e_a < 0 || e_b < 0) return -1;
  let ia = e_a, ib = e_b;
  do {
    if (BM_vert_in_edge(bm, ia, v_b)) return ia;
    if (BM_vert_in_edge(bm, ib, v_a)) return ib;
  } while ((ia = bmesh_disk_edge_next(bm, ia, v_a)) !== e_a && (ib = bmesh_disk_edge_next(bm, ib, v_b)) !== e_b);
  return -1;
}

export function BM_vert_edge_count_is_equal(bm, v, n) {
  const first = bm.v.e[v];
  let count = 0;
  if (first >= 0) {
    let e = first;
    do if (++count > n) return false; while ((e = bmesh_disk_edge_next(bm, e, v)) !== first);
  }
  return count === n;
}
export const BM_vert_is_edge_pair = (bm, v) => BM_vert_edge_count_is_equal(bm, v, 2);

// The loop of face f that uses edge e, or -1.
export function BM_face_edge_share_loop(bm, f, e) {
  const first = bm.e.l[e];
  if (first < 0) return -1;
  let l = first;
  do if (bm.l.f[l] === f) return l; while ((l = bm.l.radial_next[l]) !== first);
  return -1;
}

export function BM_face_find_double(bm, f) {
  const { l } = bm;
  const l_first = bm.f.l_first[f];
  for (let it = l.radial_next[l_first]; it !== l_first; it = l.radial_next[it]) {
    if (bm.f.len[l.f[it]] !== bm.f.len[f]) continue;
    const step = l.v[it] === l.v[l_first] ? l.next : l.prev;
    let a = l_first, b = it;
    do {
      if (l.e[a] !== l.e[b]) break;
      a = step[a];
      b = l.next[b];
    } while (b !== it);
    if (b === it) return l.f[it];
  }
  return -1;
}

export function BM_vert_is_wire_endpoint(bm, v) {
  const e = bm.v.e[v];
  return e >= 0 && bm.e.l[e] < 0 && bmesh_disk_edge_next(bm, e, v) === e;
}

// The loop of the other face on `e` that uses the vertex of loop `lp`.
export function BM_edge_other_loop(bm, e, lp) {
  const { l } = bm;
  const other = l.radial_next[l.e[lp] === e ? lp : l.prev[lp]];
  return l.v[other] === l.v[lp] ? other : l.next[other];
}
