// Queries (bmesh_query.cc, bmesh_query_inline.hh).
import { bmesh_disk_edge_next } from './bmesh-structure.js';

export const BM_vert_in_edge = (bm, e, v) => bm.e.v1[e] === v || bm.e.v2[e] === v;
export const BM_edge_other_vert = (bm, e, v) => (bm.e.v1[e] === v ? bm.e.v2[e] : bm.e.v1[e]);
export const BM_FACE_FIRST_LOOP = (bm, f) => bm.f.l_first[f];

export const BM_edge_is_wire = (bm, e) => bm.e.l[e] < 0;
// Two faces using the edge in opposite directions, so their normals agree.
export function BM_edge_is_contiguous(bm, e) {
  const l = bm.e.l[e];
  if (l < 0) return false;
  const l_other = bm.l.radial_next[l];
  return l_other !== l && bm.l.radial_next[l_other] === l && bm.l.v[l_other] !== bm.l.v[l];
}
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

export const BM_verts_in_edge = (bm, v1, v2, e) => (bm.e.v1[e] === v1 && bm.e.v2[e] === v2) || (bm.e.v1[e] === v2 && bm.e.v2[e] === v1);
export const BM_edge_share_vert_check = (bm, e1, e2) => BM_vert_in_edge(bm, e2, bm.e.v1[e1]) || BM_vert_in_edge(bm, e2, bm.e.v2[e1]);
export const BM_loop_is_adjacent = (bm, l_a, l_b) => bm.l.next[l_a] === l_b || bm.l.prev[l_a] === l_b;

// The loop of face f at vertex v, or -1.
export function BM_face_vert_share_loop(bm, f, v) {
  const first = bm.f.l_first[f];
  let l = first;
  do if (bm.l.v[l] === v) return l; while ((l = bm.l.next[l]) !== first);
  return -1;
}
export const BM_vert_in_face = (bm, v, f) => BM_face_vert_share_loop(bm, f, v) >= 0;

// The two loops (BM_edge_loop_pair) or faces (BM_edge_face_pair) of a manifold edge, or null.
export function BM_edge_loop_pair(bm, e) {
  const la = bm.e.l[e];
  if (la < 0) return null;
  const lb = bm.l.radial_next[la];
  return la !== lb && bm.l.radial_next[lb] === la ? [la, lb] : null;
}
export const BM_edge_face_pair = (bm, e) => BM_edge_loop_pair(bm, e)?.map((lp) => bm.l.f[lp]) ?? null;
// The two edges of a vert with exactly two, or null.
export function BM_vert_edge_pair(bm, v) {
  const e_a = bm.v.e[v];
  if (e_a < 0) return null;
  const e_b = bmesh_disk_edge_next(bm, e_a, v);
  return e_b !== e_a && bmesh_disk_edge_next(bm, e_b, v) === e_a ? [e_a, e_b] : null;
}
// The loop of l's face on the other edge at v.
export const BM_loop_other_edge_loop = (bm, lp, v) => (bm.l.v[lp] === v ? bm.l.prev[lp] : bm.l.next[lp]);

// Whether some face uses both edges.
export const BM_edge_share_face_check = (bm, e1, e2) => bm.e.l[e2] >= 0 && BM_FACES_OF_EDGE(bm, e1).some((f) => BM_face_edge_share_loop(bm, f, e2) >= 0);

// The iterator types of bmesh_iterators.hh as arrays, in Blender's order: `BM_ITER_ELEM (e, &iter, v,
// BM_EDGES_OF_VERT)` is `for (const e of BM_EDGES_OF_VERT(bm, v))`.
const pool_alive = (pool) => {
  const out = [];
  for (let i = 0, n = pool.size; i < n; i++) if (pool.alive[i]) out.push(i);
  return out;
};
export const BM_VERTS_OF_MESH = (bm) => pool_alive(bm.v);
export const BM_EDGES_OF_MESH = (bm) => pool_alive(bm.e);
export const BM_FACES_OF_MESH = (bm) => pool_alive(bm.f);
export const BM_VERTS_OF_EDGE = (bm, e) => [bm.e.v1[e], bm.e.v2[e]];
// Around the disk cycle from v->e.
export function BM_EDGES_OF_VERT(bm, v) {
  const out = [], first = bm.v.e[v];
  if (first < 0) return out;
  let e = first;
  do out.push(e); while ((e = bmesh_disk_edge_next(bm, e, v)) !== first);
  return out;
}
// Around the radial cycle from e->l.
export function BM_LOOPS_OF_EDGE(bm, e) {
  const out = [], first = bm.e.l[e];
  if (first < 0) return out;
  let l = first;
  do out.push(l); while ((l = bm.l.radial_next[l]) !== first);
  return out;
}
export const BM_FACES_OF_EDGE = (bm, e) => BM_LOOPS_OF_EDGE(bm, e).map((l) => bm.l.f[l]);
// Around the disk from v->e, each edge's radial loops that start at v.
export function BM_LOOPS_OF_VERT(bm, v) {
  const out = [];
  for (const e of BM_EDGES_OF_VERT(bm, v)) for (const l of BM_LOOPS_OF_EDGE(bm, e)) if (bm.l.v[l] === v) out.push(l);
  return out;
}
export const BM_FACES_OF_VERT = (bm, v) => BM_LOOPS_OF_VERT(bm, v).map((l) => bm.l.f[l]);
export function BM_LOOPS_OF_FACE(bm, f) {
  const out = [], first = bm.f.l_first[f];
  let l = first;
  do out.push(l); while ((l = bm.l.next[l]) !== first);
  return out;
}
export const BM_VERTS_OF_FACE = (bm, f) => BM_LOOPS_OF_FACE(bm, f).map((l) => bm.l.v[l]);
export const BM_EDGES_OF_FACE = (bm, f) => BM_LOOPS_OF_FACE(bm, f).map((l) => bm.l.e[l]);
// The other loops of l's edge, from l->radial_next.
export function BM_LOOPS_OF_LOOP(bm, l) {
  const out = [];
  for (let x = bm.l.radial_next[l]; x !== l; x = bm.l.radial_next[x]) out.push(x);
  return out;
}

export function BM_vert_pair_share_face_by_len(bm, v_a, v_b, allow_adjacent) {
  let best = null;
  if (bm.v.e[v_a] < 0 || bm.v.e[v_b] < 0) return null;
  BM_LOOPS_OF_VERT(bm, v_a).forEach((l_a) => {
    const f = bm.l.f[l_a];
    if (best && bm.f.len[f] >= bm.f.len[best[0]]) return;
    const l_b = BM_face_vert_share_loop(bm, f, v_b);
    if (l_b >= 0 && (allow_adjacent || !BM_loop_is_adjacent(bm, l_a, l_b))) best = [f, l_a, l_b];
  });
  return best;
}

export const BM_edge_is_any_face_len_test = (bm, e, len) => BM_FACES_OF_EDGE(bm, e).some((f) => bm.f.len[f] === len);
export function BM_edge_share_quad_check(bm, e1, e2) {
  return radialFaces(bm, e1).some((f) => bm.f.len[f] === 4 && BM_face_edge_share_loop(bm, f, e2) >= 0);
}

export * from './bmesh-query.gen.js';

// BM_iter_as_array: up to len elements of the iterator type itype (one of the arrays above) into array.
export function BM_iter_as_array(bm, itype, data, array, len) {
  const elems = itype(bm, data);
  const n = Math.min(len, elems.length);
  for (let i = 0; i < n; i++) array[i] = elems[i];
  return n;
}
