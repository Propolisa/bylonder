// Element creation and removal and the topology kernel (bmesh_core.cc). Handles are indices; -1 is null.
import { BM_VERT, BM_EDGE, BM_FACE, BM_ELEM_SELECT, BM_ELEM_SMOOTH, BM_elem_flag_test, _FLAG_JF, _FLAG_WALK, BM_ELEM_API_FLAG_TEST, BM_ELEM_API_FLAG_ENABLE, BM_ELEM_API_FLAG_DISABLE, poolAlloc, poolFree } from './bmesh-class.js';
import {
  bmesh_disk_edge_append, bmesh_disk_edge_remove, bmesh_disk_edge_next, bmesh_edge_vert_swap, bmesh_disk_vert_replace,
  bmesh_radial_loop_append, bmesh_radial_loop_remove,
} from './bmesh-structure.js';
import { BM_edge_exists, BM_edge_other_vert, BM_vert_in_edge, BM_verts_in_edge, BM_face_find_double, BM_edge_face_count_is_over } from './bmesh-query.js';
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

// `l_example` gives the new loop its custom data (UVs).
function bm_loop_create(bm, v, edge, f, l_example = -1) {
  const { l } = bm;
  const loop = poolAlloc(l);
  if (l_example >= 0) for (const layer of l.layers) layer.data.copyWithin(loop * layer.size, l_example * layer.size, l_example * layer.size + layer.size);
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

// Freeing an element also drops it from the selection history and the selection counts.
function bm_kill_only(bm, name, htype, total, i) {
  BM_select_history_remove(bm, htype, i);
  if (BM_elem_flag_test(bm[name], i, BM_ELEM_SELECT) && bm[total]) bm[total]--;
  poolFree(bm[name], i);
}
const bm_kill_only_vert = (bm, v) => bm_kill_only(bm, 'v', BM_VERT, 'totvertsel', v);
const bm_kill_only_edge = (bm, e) => bm_kill_only(bm, 'e', BM_EDGE, 'totedgesel', e);
const bm_kill_only_loop = (bm, l) => poolFree(bm.l, l);
function bm_kill_only_face(bm, f) {
  if (bm.act_face === f) bm.act_face = -1;
  bm_kill_only(bm, 'f', BM_FACE, 'totfacesel', f);
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

// bmesh_kernel_loop_reverse: flips a face's winding; each loop takes the previous loop's edge and radial links.
export function bmesh_kernel_loop_reverse(bm, f) {
  const { l } = bm;
  const l_first = bm.f.l_first[f];
  let e_prev = l.e[l.prev[l_first]];
  let prev_radial_next = l.radial_next[l.prev[l_first]], prev_radial_prev = l.radial_prev[l.prev[l_first]];
  let prev_boundary = prev_radial_next === l.radial_next[prev_radial_next];
  let it = l_first;
  do {
    const e_iter = l.e[it], radial_next = l.radial_next[it], radial_prev = l.radial_prev[it];
    const boundary = radial_next === l.radial_next[radial_next];
    if (prev_boundary) l.radial_next[it] = l.radial_prev[it] = it;
    else {
      l.radial_next[it] = prev_radial_next;
      l.radial_prev[it] = prev_radial_prev;
      l.radial_prev[prev_radial_next] = it;
      l.radial_next[prev_radial_prev] = it;
    }
    if (bm.e.l[e_iter] === it) bm.e.l[e_iter] = l.next[it];
    l.e[it] = e_prev;
    [l.next[it], l.prev[it]] = [l.prev[it], l.next[it]];
    e_prev = e_iter;
    prev_radial_next = radial_next;
    prev_radial_prev = radial_prev;
    prev_boundary = boundary;
  } while ((it = l.prev[it]) !== l_first);
}

// Split Face Make Edge: cuts f between the verts of l_v1 and l_v2. f keeps the loops from l_v1 to l_v2's previous
// loop, f2 gets the rest; r_l (returned with f2) is f2's new loop.
export function bmesh_kernel_split_face_make_edge(bm, f, l_v1, l_v2, e_example = -1, no_double = false) {
  const { l } = bm;
  const v1 = l.v[l_v1], v2 = l.v[l_v2];
  const e = BM_edge_create(bm, v1, v2, e_example, no_double ? BM_CREATE_NO_DOUBLE : BM_CREATE_NOP);
  const f2 = bm_face_create__internal(bm);
  BM_elem_attrs_copy(bm.f, f, f2);
  const l_f1 = bm_loop_create(bm, v2, e, f, l_v2), l_f2 = bm_loop_create(bm, v1, e, f2, l_v1);
  l.prev[l_f1] = l.prev[l_v2];
  l.prev[l_f2] = l.prev[l_v1];
  l.next[l.prev[l_v2]] = l_f1;
  l.next[l.prev[l_v1]] = l_f2;
  l.next[l_f1] = l_v1;
  l.next[l_f2] = l_v2;
  l.prev[l_v1] = l_f1;
  l.prev[l_v2] = l_f2;

  const first = bm.f.l_first[f];
  let first_in_f1 = false, it = l_f1;
  do if (it === first) first_in_f1 = true; while ((it = l.next[it]) !== l_f1);
  // f2 starts as close as possible to where f started; tools such as dupli-faces rely on the order.
  if (first_in_f1) bm.f.l_first[f2] = l.prev[first] === l_f1 ? l.prev[l_f2] : l.next[first] === l_f1 ? l.next[l_f2] : l_f2;
  else {
    bm.f.l_first[f2] = first;
    bm.f.l_first[f] = l.prev[first] === l_f2 ? l.prev[l_f1] : l.next[first] === l_f2 ? l.next[l_f1] : l_f1;
  }
  const count = (face) => { let n = 0; const start = bm.f.l_first[face]; let lp = start; do { if (face === f2) l.f[lp] = f2; n++; } while ((lp = l.next[lp]) !== start); return n; };
  bm.f.len[f2] = count(f2);
  bmesh_radial_loop_append(bm, e, l_f1);
  bmesh_radial_loop_append(bm, e, l_f2);
  bm.f.len[f] = count(f);
  return [f2, l_f2];
}

// Split Edge Make Vert: a new vert on e next to tv; e now runs from the new vert to the other end and the
// returned edge from tv to the new vert. Returns [v_new, e_new].
export function bmesh_kernel_split_edge_make_vert(bm, tv, e) {
  const { l } = bm;
  const v_new = BM_vert_create(bm, bm.v.co.subarray(tv * 3, tv * 3 + 3), tv);
  const e_new = BM_edge_create(bm, tv, v_new, e);
  bmesh_disk_edge_remove(bm, e_new, tv);
  bmesh_disk_edge_remove(bm, e_new, v_new);
  bmesh_disk_vert_replace(bm, e, v_new, tv);
  bmesh_disk_edge_append(bm, e_new, v_new);
  bmesh_disk_edge_append(bm, e_new, tv);

  let l_next = bm.e.l[e];
  bm.e.l[e] = -1;
  while (l_next >= 0) {
    const lp = l_next;
    bm.f.len[l.f[lp]]++;
    l_next = l_next !== l.radial_next[l_next] ? l.radial_next[l_next] : -1;
    if (l.radial_next[lp] !== lp) {
      l.radial_prev[l.radial_next[lp]] = l.radial_prev[lp];
      l.radial_next[l.radial_prev[lp]] = l.radial_next[lp];
    }
    l.radial_next[lp] = l.radial_prev[lp] = -1;
    l.e[lp] = -1;
    const l_new = bm_loop_create(bm, v_new, -1, l.f[lp], lp);
    l.prev[l_new] = lp;
    l.next[l_new] = l.next[lp];
    l.next[lp] = l_new;
    l.prev[l.next[l_new]] = l_new;
    const onE = BM_verts_in_edge(bm, l.v[l_new], l.v[l.next[l_new]], e);
    if (!onE && !BM_verts_in_edge(bm, l.v[l_new], l.v[l.next[l_new]], e_new)) continue;
    l.e[l_new] = onE ? e : e_new;
    l.e[lp] = onE ? e_new : e;
    bmesh_radial_loop_append(bm, l.e[l_new], l_new);
    bmesh_radial_loop_append(bm, l.e[lp], lp);
  }
  return [v_new, e_new];
}

// Moves `l_sep` off e onto a new copy of e, so its face no longer shares e.
export function bmesh_kernel_edge_separate(bm, e, l_sep) {
  const { l } = bm;
  if (l.radial_next[bm.e.l[e]] === bm.e.l[e]) return;
  if (l_sep === bm.e.l[e]) bm.e.l[e] = l.radial_next[l_sep];
  const e_new = BM_edge_create(bm, bm.e.v1[e], bm.e.v2[e], e);
  bmesh_radial_loop_remove(bm, e, l_sep);
  bmesh_radial_loop_append(bm, e_new, l_sep);
  l.e[l_sep] = e_new;
  return e_new;
}

// Splits v into one vert per fan of faces (and wire edge). Returns the verts, v first, then the new ones newest
// first (as Blender's small stack lists them).
export function bmesh_kernel_vert_separate(bm, v) {
  const { l } = bm, EDGE_VISIT = _FLAG_WALK;
  const verts_new = [];
  const first = bm.v.e[v];
  if (first >= 0) {
    let v_edges_num = 0, edges_found = 0, e = first;
    do { v_edges_num++; BM_ELEM_API_FLAG_ENABLE(bm.e, e, EDGE_VISIT); } while ((e = bmesh_disk_edge_next(bm, e, v)) !== first);
    for (;;) {
      const edges = [], edges_search = [];
      e = bm.v.e[v];
      BM_ELEM_API_FLAG_DISABLE(bm.e, e, EDGE_VISIT);
      do {
        edges.push(e);
        edges_found++;
        const l0 = bm.e.l[e];
        if (l0 >= 0) {
          let it = l0;
          do {
            const adjacent = l.e[l.v[it] === v ? l.prev[it] : l.next[it]];
            if (BM_ELEM_API_FLAG_TEST(bm.e, adjacent, EDGE_VISIT)) {
              BM_ELEM_API_FLAG_DISABLE(bm.e, adjacent, EDGE_VISIT);
              edges_search.push(adjacent);
            }
          } while ((it = l.radial_next[it]) !== l0);
        }
      } while ((e = edges_search.length ? edges_search.pop() : -1) >= 0);
      if (edges_found === v_edges_num) break;
      const v_new = BM_vert_create(bm, bm.v.co.subarray(v * 3, v * 3 + 3), v);
      while (edges.length) bmesh_edge_vert_swap(bm, edges.pop(), v_new, v);
      verts_new.push(v_new);
    }
  }
  return [v, ...verts_new.reverse()];
}

// Merges v_src into v_dst (they must not share a face).
export function BM_vert_splice(bm, v_dst, v_src) {
  if (v_src === v_dst) return false;
  while (bm.v.e[v_src] >= 0) bmesh_edge_vert_swap(bm, bm.v.e[v_src], v_dst, v_src);
  BM_vert_kill(bm, v_src);
  return true;
}

// bmesh_face_swap_data: the two faces trade loops and fields, keeping their index and custom data.
export function bmesh_face_swap_data(bm, f_a, f_b) {
  const { f, l } = bm;
  for (const [face, other] of [[f_a, f_b], [f_b, f_a]]) {
    const first = f.l_first[face];
    let it = first;
    do l.f[it] = other; while ((it = l.next[it]) !== first);
  }
  for (const [name, n] of f.fields) {
    if (name === 'index' || name === 'oflag') continue;
    const a = f[name].slice(f_a * n, f_a * n + n);
    f[name].copyWithin(f_a * n, f_b * n, f_b * n + n);
    f[name].set(a, f_b * n);
  }
}
