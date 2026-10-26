// Element creation and removal and the topology kernel (bmesh_core.cc). Handles are indices; -1 is null.
import { BM_VERT, BM_EDGE, BM_FACE, BM_ELEM_SELECT, BM_ELEM_SMOOTH, _FLAG_JF, BM_ELEM_API_FLAG_TEST, BM_ELEM_API_FLAG_ENABLE, BM_ELEM_API_FLAG_DISABLE, poolAlloc, poolFree } from './bmesh-class.js';
import {
  bmesh_disk_edge_append, bmesh_disk_edge_remove, bmesh_disk_edge_next, bmesh_edge_vert_swap,
  bmesh_radial_loop_append, bmesh_radial_loop_remove,
} from './bmesh-structure.js';
import { BM_edge_exists, BM_edge_other_vert, BM_vert_in_edge, BM_face_find_double, BM_edge_face_count_is_over } from './bmesh-query.js';
import { BM_face_create_ngon } from './bmesh-construct.js';
import { BM_select_history_remove } from './bmesh-marking.js';

export const BM_CREATE_NOP = 0, BM_CREATE_NO_DOUBLE = 1 << 1, BM_CREATE_SKIP_CD = 1 << 2;

export function BM_vert_create(bm, co, v_example = -1, create_flag = BM_CREATE_NOP) {
  const v = poolAlloc(bm.v);
  bm.v.co.set(co, v * 3);
  bm.v.e[v] = -1;
  bm.v.index[v] = -1;
  if (v_example >= 0 && !(create_flag & BM_CREATE_SKIP_CD)) BM_elem_attrs_copy(bm.v, v_example, v);
  return v;
}

export function BM_edge_create(bm, v1, v2, e_example = -1, create_flag = BM_CREATE_NOP) {
  if (create_flag & BM_CREATE_NO_DOUBLE) {
    const existing = BM_edge_exists(bm, v1, v2);
    if (existing >= 0) return existing;
  }
  const { e } = bm;
  const edge = poolAlloc(e);
  e.index[edge] = -1;
  e.hflag[edge] = BM_ELEM_SMOOTH;
  e.v1[edge] = v1;
  e.v2[edge] = v2;
  e.l[edge] = -1;
  e.v1_disk_next[edge] = e.v1_disk_prev[edge] = e.v2_disk_next[edge] = e.v2_disk_prev[edge] = -1;
  bmesh_disk_edge_append(bm, edge, v1);
  bmesh_disk_edge_append(bm, edge, v2);
  if (e_example >= 0 && !(create_flag & BM_CREATE_SKIP_CD)) BM_elem_attrs_copy(e, e_example, edge);
  return edge;
}

function bm_loop_create(bm, v, edge, f) {
  const { l } = bm;
  const loop = poolAlloc(l);
  l.v[loop] = v;
  l.e[loop] = edge;
  l.f[loop] = f;
  l.next[loop] = l.prev[loop] = l.radial_next[loop] = l.radial_prev[loop] = -1;
  l.index[loop] = -1;
  return loop;
}

function bm_face_create__internal(bm) {
  const f = poolAlloc(bm.f);
  bm.f.l_first[f] = -1;
  bm.f.index[f] = -1;
  return f;
}

export function BM_face_create(bm, verts, edges, len, f_example = -1, create_flag = BM_CREATE_NOP) {
  if (len === 0) return -1;
  const { l } = bm;
  const f = bm_face_create__internal(bm);
  const startl = bm_loop_create(bm, verts[0], edges[0], f);
  bmesh_radial_loop_append(bm, edges[0], startl);
  bm.f.l_first[f] = startl;
  let lastl = startl;
  for (let i = 1; i < len; i++) {
    const loop = bm_loop_create(bm, verts[i], edges[i], f);
    bmesh_radial_loop_append(bm, edges[i], loop);
    l.prev[loop] = lastl;
    l.next[lastl] = loop;
    lastl = loop;
  }
  l.prev[startl] = lastl;
  l.next[lastl] = startl;
  bm.f.len[f] = len;
  if (f_example >= 0 && !(create_flag & BM_CREATE_SKIP_CD)) BM_elem_attrs_copy(bm.f, f_example, f);
  return f;
}

// BM_elem_attrs_copy: header flags except selection, normal, material and custom data.
export function BM_elem_attrs_copy(pool, src, dst) {
  pool.hflag[dst] = (pool.hflag[src] & ~BM_ELEM_SELECT) | (pool.hflag[dst] & BM_ELEM_SELECT);
  if (pool.no) pool.no.copyWithin(dst * 3, src * 3, src * 3 + 3);
  if (pool.mat_nr) pool.mat_nr[dst] = pool.mat_nr[src];
  for (const layer of pool.layers) layer.data.copyWithin(dst * layer.size, src * layer.size, src * layer.size + layer.size);
}

const bm_kill_only_vert = (bm, v) => { BM_select_history_remove(bm, BM_VERT, v); poolFree(bm.v, v); };
const bm_kill_only_edge = (bm, e) => { BM_select_history_remove(bm, BM_EDGE, e); poolFree(bm.e, e); };
const bm_kill_only_loop = (bm, l) => poolFree(bm.l, l);
function bm_kill_only_face(bm, f) {
  if (bm.act_face === f) bm.act_face = -1;
  BM_select_history_remove(bm, BM_FACE, f);
  poolFree(bm.f, f);
}

export function BM_face_kill(bm, f) {
  const { l } = bm;
  const first = bm.f.l_first[f];
  if (first >= 0) {
    let it = first, next;
    do {
      next = l.next[it];
      bmesh_radial_loop_remove(bm, l.e[it], it);
      bm_kill_only_loop(bm, it);
    } while ((it = next) !== first);
  }
  bm_kill_only_face(bm, f);
}

export function BM_edge_kill(bm, e) {
  while (bm.e.l[e] >= 0) BM_face_kill(bm, bm.l.f[bm.e.l[e]]);
  bmesh_disk_edge_remove(bm, e, bm.e.v1[e]);
  bmesh_disk_edge_remove(bm, e, bm.e.v2[e]);
  bm_kill_only_edge(bm, e);
}

export function BM_vert_kill(bm, v) {
  while (bm.v.e[v] >= 0) BM_edge_kill(bm, bm.v.e[v]);
  bm_kill_only_vert(bm, v);
}

export function BM_edge_splice(bm, e_dst, e_src) {
  if (!BM_vert_in_edge(bm, e_src, bm.e.v1[e_dst]) || !BM_vert_in_edge(bm, e_src, bm.e.v2[e_dst])) return false;
  while (bm.e.l[e_src] >= 0) {
    const l = bm.e.l[e_src];
    bmesh_radial_loop_remove(bm, e_src, l);
    bmesh_radial_loop_append(bm, e_dst, l);
  }
  BM_edge_kill(bm, e_src);
  return true;
}

// JVKE: collapses e_kill into its other vert, merging v_kill's edges into v_target.
export function bmesh_kernel_join_vert_kill_edge(bm, e_kill, v_kill, do_del, check_edge_exists, kill_degenerate_faces) {
  const { l } = bm;
  const v_target = BM_edge_other_vert(bm, e_kill, v_kill);
  const degenerate = [];
  const first = bm.e.l[e_kill];
  if (first >= 0) {
    let l_kill = first, l_kill_next;
    do {
      if (l.v[l.next[l_kill]] === v_kill) l.v[l.next[l_kill]] = v_target;
      l.prev[l.next[l_kill]] = l.prev[l_kill];
      l.next[l.prev[l_kill]] = l.next[l_kill];
      const f = l.f[l_kill];
      if (bm.f.l_first[f] === l_kill) bm.f.l_first[f] = l.next[l_kill];
      bm.f.len[f]--;
      if (kill_degenerate_faces && bm.f.len[f] < 3) degenerate.push(f);
      l_kill_next = l.radial_next[l_kill];
      bm_kill_only_loop(bm, l_kill);
    } while ((l_kill = l_kill_next) !== first);
    bm.e.l[e_kill] = -1;
  }
  BM_edge_kill(bm, e_kill);
  if (bm.v.e[v_target] >= 0 && bm.v.e[v_kill] >= 0) {
    let e;
    while ((e = bm.v.e[v_kill]) >= 0) {
      const e_target = check_edge_exists ? BM_edge_exists(bm, v_target, BM_edge_other_vert(bm, e, v_kill)) : -1;
      bmesh_edge_vert_swap(bm, e, v_target, v_kill);
      if (e_target >= 0) BM_edge_splice(bm, e_target, e);
    }
  }
  if (kill_degenerate_faces) while (degenerate.length) BM_face_kill(bm, degenerate.pop());
  if (do_del) bm_kill_only_vert(bm, v_kill);
  return v_target;
}

function bm_loop_systag_count_radial(bm, l, flag) {
  let it = l, count = 0;
  do if (BM_ELEM_API_FLAG_TEST(bm.f, bm.l.f[it], flag)) count++; while ((it = bm.l.radial_next[it]) !== l);
  return count;
}

function bm_vert_is_manifold_flagged(bm, v, flag) {
  const first = bm.v.e[v];
  if (first < 0) return false;
  let e = first;
  do {
    const l0 = bm.e.l[e];
    if (l0 < 0) return false;
    if (bm.l.radial_next[l0] === l0) return false;
    let l = l0;
    do if (!BM_ELEM_API_FLAG_TEST(bm.f, bm.l.f[l], flag)) return false; while ((l = bm.l.radial_next[l]) !== l0);
  } while ((e = bmesh_disk_edge_next(bm, e, v)) !== first);
  return true;
}

// Joins a contiguous manifold region of faces into one. Returns [f_new, f_double].
export function BM_faces_join(bm, faces, do_del, want_double) {
  const { l } = bm;
  if (faces.length === 1) return [faces[0], -1];
  const had_active_face = bm.act_face >= 0;
  const setFaces = (on) => faces.forEach((f) => (on ? BM_ELEM_API_FLAG_ENABLE : BM_ELEM_API_FLAG_DISABLE)(bm.f, f, _FLAG_JF));
  setFaces(true);
  const edges = [], deledges = [], delverts = [];
  let v1 = -1, v2 = -1;
  for (const f of faces) {
    const first = bm.f.l_first[f];
    let it = first;
    do {
      const rlen = bm_loop_systag_count_radial(bm, it, _FLAG_JF);
      const e = l.e[it];
      if (rlen > 2) { setFaces(false); return [-1, -1]; }
      if (rlen === 1) {
        edges.push(e);
        if (v1 < 0) { v1 = l.v[it]; v2 = BM_edge_other_vert(bm, e, l.v[it]); }
      } else if (rlen === 2) {
        const ev1 = bm.e.v1[e], ev2 = bm.e.v2[e];
        const d1 = bm_vert_is_manifold_flagged(bm, ev1, _FLAG_JF), d2 = bm_vert_is_manifold_flagged(bm, ev2, _FLAG_JF);
        if (!d1 && !d2 && !BM_ELEM_API_FLAG_TEST(bm.e, e, _FLAG_JF)) {
          if (!BM_edge_face_count_is_over(bm, e, 2)) {
            if (do_del) deledges.push(e);
            BM_ELEM_API_FLAG_ENABLE(bm.e, e, _FLAG_JF);
          }
        } else {
          if (d1 && !BM_ELEM_API_FLAG_TEST(bm.v, ev1, _FLAG_JF)) { if (do_del) delverts.push(ev1); BM_ELEM_API_FLAG_ENABLE(bm.v, ev1, _FLAG_JF); }
          if (d2 && !BM_ELEM_API_FLAG_TEST(bm.v, ev2, _FLAG_JF)) { if (do_del) delverts.push(ev2); BM_ELEM_API_FLAG_ENABLE(bm.v, ev2, _FLAG_JF); }
        }
      }
    } while ((it = l.next[it]) !== first);
  }
  const f_new = edges.length ? BM_face_create_ngon(bm, v1, v2, edges, faces[0]) : -1;
  if (f_new < 0) { setFaces(false); return [-1, -1]; }
  let result = f_new, f_double = -1;
  const f_existing = BM_face_find_double(bm, f_new);
  if (f_existing >= 0) {
    if (want_double) f_double = f_existing;
    else { BM_face_kill(bm, f_new); result = f_existing; }
  }
  if (!(f_existing >= 0 && !want_double)) {
    const first = bm.f.l_first[result];
    let it = first;
    do {
      let l2 = l.radial_next[it];
      do { if (BM_ELEM_API_FLAG_TEST(bm.f, l.f[l2], _FLAG_JF)) break; l2 = l.radial_next[l2]; } while (l2 !== it);
      if (l2 !== it) {
        if (l.v[l2] !== l.v[it]) l2 = l.next[l2];
        BM_elem_attrs_copy(bm.l, l2, it);
      }
    } while ((it = l.next[it]) !== first);
  }
  setFaces(false);
  BM_ELEM_API_FLAG_DISABLE(bm.f, result, _FLAG_JF);
  if (do_del) {
    for (const e of deledges) BM_edge_kill(bm, e);
    for (const v of delverts) BM_vert_kill(bm, v);
  } else {
    for (const f of faces) BM_face_kill(bm, f);
  }
  if (had_active_face && bm.act_face < 0) bm.act_face = result;
  return [result, f_double];
}
