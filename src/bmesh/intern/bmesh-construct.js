// Construction helpers (bmesh_construct.cc).
import { _FLAG_MF, _FLAG_MV, BM_ELEM_API_FLAG_TEST, BM_ELEM_API_FLAG_ENABLE, BM_ELEM_API_FLAG_DISABLE } from './bmesh-class.js';
import { BM_edge_create, BM_face_create, BM_CREATE_NO_DOUBLE, BM_CREATE_NOP } from './bmesh-core.js';
import { bmesh_disk_edge_next } from './bmesh-structure.js';
import { BM_edge_other_vert } from './bmesh-query.js';

// Edges between consecutive verts, created where missing: edge i joins vert i and vert i + 1.
export function BM_edges_from_verts_ensure(bm, verts) {
  const edges = new Array(verts.length);
  for (let i = 0, i_prev = verts.length - 1; i < verts.length; i_prev = i++) {
    edges[i_prev] = BM_edge_create(bm, verts[i_prev], verts[i], -1, BM_CREATE_NO_DOUBLE);
  }
  return edges;
}

export function BM_face_create_verts(bm, verts, f_example = -1, create_flag = BM_CREATE_NOP, create_edges = true) {
  const edges = create_edges ? BM_edges_from_verts_ensure(bm, verts) : null;
  return BM_face_create(bm, verts, edges, verts.length, f_example, create_flag);
}

export const BM_face_create_quad_tri = (bm, v1, v2, v3, v4 = -1, f_example = -1, create_flag = BM_CREATE_NOP) =>
  BM_face_create_verts(bm, v4 >= 0 ? [v1, v2, v3, v4] : [v1, v2, v3], f_example, create_flag, true);

// Orders `edges` into a loop starting at v1, heading for v2. Returns [edges_sort, verts_sort] or null.
function bm_edges_sort_winding(bm, v1, v2, edges) {
  const len = edges.length, edges_sort = [], verts_sort = [];
  const clear = () => {
    for (const e of edges) {
      BM_ELEM_API_FLAG_DISABLE(bm.e, e, _FLAG_MF);
      BM_ELEM_API_FLAG_DISABLE(bm.v, bm.e.v1[e], _FLAG_MV);
      BM_ELEM_API_FLAG_DISABLE(bm.v, bm.e.v2[e], _FLAG_MV);
    }
  };
  for (const e of edges) {
    BM_ELEM_API_FLAG_ENABLE(bm.e, e, _FLAG_MF);
    BM_ELEM_API_FLAG_ENABLE(bm.v, bm.e.v1[e], _FLAG_MV);
    BM_ELEM_API_FLAG_ENABLE(bm.v, bm.e.v2[e], _FLAG_MV);
  }
  let v_iter = v1, e_first = bm.v.e[v1], e_iter = e_first, found = false;
  do {
    if (BM_ELEM_API_FLAG_TEST(bm.e, e_iter, _FLAG_MF) && BM_edge_other_vert(bm, e_iter, v_iter) === v2) { found = true; break; }
  } while ((e_iter = bmesh_disk_edge_next(bm, e_iter, v_iter)) !== e_first);
  if (!found) { clear(); return null; }
  do {
    if (BM_ELEM_API_FLAG_TEST(bm.e, e_iter, _FLAG_MF)) {
      if (!BM_ELEM_API_FLAG_TEST(bm.v, v_iter, _FLAG_MV)) { clear(); return null; }
      BM_ELEM_API_FLAG_DISABLE(bm.e, e_iter, _FLAG_MF);
      edges_sort.push(e_iter);
      BM_ELEM_API_FLAG_DISABLE(bm.v, v_iter, _FLAG_MV);
      verts_sort.push(v_iter);
      v_iter = BM_edge_other_vert(bm, e_iter, v_iter);
      if (edges_sort.length === len) {
        if (v_iter !== verts_sort[0]) { clear(); return null; }
        break;
      }
      e_first = e_iter;
    }
  } while ((e_iter = bmesh_disk_edge_next(bm, e_iter, v_iter)) !== e_first);
  if (edges_sort.length === len) return [edges_sort, verts_sort];
  clear();
  return null;
}

export function BM_face_create_ngon(bm, v1, v2, edges, f_example = -1, create_flag = BM_CREATE_NOP) {
  const sorted = bm_edges_sort_winding(bm, v1, v2, edges);
  return sorted ? BM_face_create(bm, sorted[1], sorted[0], edges.length, f_example, create_flag) : -1;
}
