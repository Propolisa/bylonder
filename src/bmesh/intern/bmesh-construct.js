// Construction helpers (bmesh_construct.cc).
import { _FLAG_MF, _FLAG_MV, BM_ELEM_SELECT, BM_ELEM_API_FLAG_TEST, BM_ELEM_API_FLAG_ENABLE, BM_ELEM_API_FLAG_DISABLE } from './bmesh-class.js';
import { BM_edge_create, BM_face_create, BM_face_create_verts, BM_CREATE_NO_DOUBLE, BM_CREATE_NOP } from './bmesh-core.js';
import { bmesh_disk_edge_next } from './bmesh-structure.js';
import { BM_edge_other_vert, BM_edge_exists } from './bmesh-query.js';
import { BM_verts_calc_normal_from_cloud_ex } from './bmesh-polygon.js';
import { angle_signed_on_axis_v3v3v3_v3 } from '../../blenlib/math-geom.js';
import { CustomData_bmesh_copy_block } from '../../blenkernel/customdata.js';

// Fills edge_arr with the edges between consecutive verts, created where missing: edge i joins vert i and i + 1.
export function BM_edges_from_verts_ensure(bm, edge_arr, vert_arr, len) {
  for (let i = 0, i_prev = len - 1; i < len; i_prev = i++) {
    edge_arr[i_prev] = BM_edge_create(bm, vert_arr[i_prev], vert_arr[i], -1, BM_CREATE_NO_DOUBLE);
  }
}

export function BM_face_create_quad_tri(bm, v1, v2, v3, v4, f_example, create_flag) {
  const verts = v4 >= 0 ? [v1, v2, v3, v4] : [v1, v2, v3];
  return BM_face_create_verts(bm, verts, verts.length, f_example, create_flag, true);
}

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

// Fills edge_arr with the existing edges between consecutive verts; false when one is missing.
export function BM_edges_from_verts(bm, edge_arr, vert_arr, len) {
  for (let i = 0, i_prev = len - 1; i < len; i_prev = i++) {
    edge_arr[i_prev] = BM_edge_exists(bm, vert_arr[i_prev], vert_arr[i]);
    if (edge_arr[i_prev] < 0) return false;
  }
  return true;
}

// A face through `verts` in order. With `calc_winding` its winding opposes the faces already on its edges.
export function BM_face_create_ngon_verts(bm, verts, len, f_example, create_flag, calc_winding, create_edges) {
  const edges = new Array(len), winding = [0, 0];
  for (let i = 0, i_prev = len - 1; i < len; i_prev = i++) {
    edges[i] = create_edges ? BM_edge_create(bm, verts[i_prev], verts[i], -1, BM_CREATE_NO_DOUBLE) : BM_edge_exists(bm, verts[i_prev], verts[i]);
    if (edges[i] < 0) return -1;
    const l = bm.e.l[edges[i]];
    if (calc_winding && l >= 0) winding[verts[i_prev] === bm.l.v[l] ? 1 : 0]++;
  }
  const reverse = calc_winding && winding[0] < winding[1];
  const v_winding = [verts[len - 1], verts[0]];
  return BM_face_create_ngon(bm, v_winding[reverse ? 1 : 0], v_winding[reverse ? 0 : 1], edges, f_example, create_flag);
}

// Orders verts by angle around their best fit normal, so they make an n-gon.
export function BM_verts_sort_radial_plane(bm, verts) {
  const { normal, center, index_tangent } = BM_verts_calc_normal_from_cloud_ex(bm, verts);
  const co = (v) => [...bm.v.co.subarray(v * 3, v * 3 + 3)], far = co(verts[index_tangent]);
  const angles = verts.map((v) => angle_signed_on_axis_v3v3v3_v3(far, center, co(v), normal));
  return verts.map((v, i) => i).sort((a, b) => angles[a] - angles[b]).map((i) => verts[i]);
}

// BM_face_copy_shared: each corner takes the loop data of the face across its edge, where `filter(l_src)` allows.
export function BM_face_copy_shared(bm, f, filter = () => true) {
  const { l } = bm, copied = new Set();
  const first = bm.f.l_first[f];
  let it = first;
  do {
    const other = l.radial_next[it];
    if (other !== it) {
      const src = l.v[other] === l.v[it] ? [other, l.next[other]] : [l.next[other], other];
      [it, l.next[it]].forEach((dst, j) => {
        if (copied.has(dst) || !filter(src[j])) return;
        CustomData_bmesh_copy_block(bm.ldata, src[j], dst);
        copied.add(dst);
      });
    }
  } while ((it = l.next[it]) !== first);
}


// BM_elem_attrs_copy, one function for Blender's overloads per element type, so it takes the pool: header flags
// except selection, normal, material and custom data.
export function BM_elem_attrs_copy(pool, src, dst) {
  pool.hflag[dst] = (pool.hflag[src] & ~BM_ELEM_SELECT) | (pool.hflag[dst] & BM_ELEM_SELECT);
  if (pool.no) pool.no.copyWithin(dst * 3, src * 3, src * 3 + 3);
  if (pool.mat_nr) pool.mat_nr[dst] = pool.mat_nr[src];
  CustomData_bmesh_copy_block(pool, src, dst);
}

export * from './bmesh-construct.gen.js';
