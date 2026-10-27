// Dissolve operators (bmo_dissolve.cc).
import { BM_ITER_MESH, BM_ELEM_HIDDEN, BM_ELEM_SELECT, BM_elem_flag_test, BM_elem_flag_enable, BM_elem_flag_merge_ex, BMO_flag_test, BMO_flag_enable, BMO_flag_disable } from '../intern/bmesh-class.js';
import { BM_faces_join, BM_face_kill, BM_edge_kill, BM_vert_kill } from '../intern/bmesh-core.js';
import { BM_face_split, BM_faces_join_pair, BM_vert_collapse_edge } from '../intern/bmesh-mods.js';
import { BM_EDGES_OF_VERT, BM_LOOPS_OF_VERT, BM_edge_other_vert, BM_edge_is_wire, BM_edge_is_boundary, BM_vert_is_edge_pair, BM_vert_edge_pair, BM_edge_face_pair, BM_edge_loop_pair, BM_loop_other_edge_loop } from '../intern/bmesh-query.js';
import { bmesh_disk_edge_next } from '../intern/bmesh-structure.js';
import { BM_face_calc_normal } from '../intern/bmesh-polygon.js';
import { BM_edge_select_set_noflush } from '../intern/bmesh-marking.js';
import { dot_v3, angle_v3v3v3, angle_on_axis_v3v3v3_v3, interpf } from '../../blenlib/math-geom.js';
import { BMW_island } from '../intern/bmesh-walkers.js';

const FACE_MARK = 1 << 1, FACE_ORIG = 1 << 2, FACE_NEW = 1 << 3, FACE_TAG = 1 << 4;

// dissolve_faces: joins each manifold region of `faces` into one face. Returns region.out. Run through bmo_call.
export function bmo_dissolve_faces_exec(bm, faces) {
  for (const f of faces) BMO_flag_enable(bm.f, f, FACE_MARK | FACE_TAG);
  const regions = [];
  for (const f of faces) {
    if (!BMO_flag_test(bm.f, f, FACE_TAG)) continue;
    const region = BMW_island(bm, f, { mask_face: FACE_MARK, only_manifold: true });
    if (region.length < 2) continue;
    for (const face of region) {
      BMO_flag_disable(bm.f, face, FACE_TAG);
      BMO_flag_enable(bm.f, face, FACE_ORIG);
    }
    regions.push(region);
  }
  for (const region of regions) {
    let [f_new, f_double] = BM_faces_join(bm, region, true, true);
    if (f_new >= 0) {
      if (f_double >= 0) {
        BM_face_kill(bm, f_new);
        f_new = f_double;
      }
      BMO_flag_disable(bm.f, f_new, FACE_ORIG);
      BMO_flag_enable(bm.f, f_new, FACE_NEW);
    } else {
      for (const face of region) BMO_flag_disable(bm.f, face, FACE_ORIG);
    }
  }
  const region_out = [];
  BM_ITER_MESH(bm.f, (f) => BMO_flag_test(bm.f, f, FACE_NEW) && region_out.push(f));
  return region_out;
}

const EDGE_TAG = 2, EDGE_ISGC = 8, EDGE_CHAIN = 16;
const VERT_MARK = 1, VERT_TAG = 2, VERT_MARK_PAIR = 4, VERT_ISGC = 8, VERT_MARK_TEAR = 16;
const coOf = (bm, v) => [bm.v.co[v * 3], bm.v.co[v * 3 + 1], bm.v.co[v * 3 + 2]];
const loopsOfFace = (bm, f) => { const out = [], first = bm.f.l_first[f]; let l = first; do out.push(l); while ((l = bm.l.next[l]) !== first); return out; };

// The angle at a vert with two edges: the raw angle, blended towards the angle around the vert normal as its two
// faces fold past 90 degrees.
function bmo_vert_calc_edge_angle_blended(bm, v) {
  const [e_a, e_b] = BM_vert_edge_pair(bm, v);
  const v_a = coOf(bm, BM_edge_other_vert(bm, e_a, v)), v_b = coOf(bm, BM_edge_other_vert(bm, e_b, v)), co = coOf(bm, v);
  const angle = Math.PI - angle_v3v3v3(v_a, co, v_b);
  const faces = BM_edge_face_pair(bm, bm.v.e[v]);
  if (!faces) return angle;
  const raw_factor = Math.min(1, Math.max(0, -dot_v3(BM_face_calc_normal(bm, faces[0]), BM_face_calc_normal(bm, faces[1]))));
  return interpf(angle, Math.PI - angle_on_axis_v3v3v3_v3(v_a, co, v_b, [...bm.v.no.subarray(v * 3, v * 3 + 3)]), raw_factor);
}

// BM_vert_collapse_edge, keeping hidden state consistent and merging the two edges' flags.
function bm_vert_collapse_edge_and_merge(bm, v, do_del) {
  const [e_a, e_b] = BM_vert_edge_pair(bm, v);
  BM_elem_flag_merge_ex(bm.e, e_a, bm.e, e_b, BM_ELEM_HIDDEN);
  const e_new = BM_vert_collapse_edge(bm, bm.v.e[v], v, do_del, true, true);
  if (e_new >= 0 && !BM_elem_flag_test(bm.e, e_new, BM_ELEM_HIDDEN) && (BM_elem_flag_test(bm.v, bm.e.v1[e_new], BM_ELEM_HIDDEN) || BM_elem_flag_test(bm.v, bm.e.v2[e_new], BM_ELEM_HIDDEN))) {
    if (BM_elem_flag_test(bm.e, e_new, BM_ELEM_SELECT)) BM_edge_select_set_noflush(bm, e_new, false);
    BM_elem_flag_enable(bm.e, e_new, BM_ELEM_HIDDEN);
  }
  return e_new;
}

// Splits faces across each flagged vert that is not an edge pair, between its neighbours; with `use_edge_delete`
// the vert's edges and faces then go.
function bm_face_split(bm, oflag, use_edge_delete) {
  const { l } = bm, tear = [];
  BM_ITER_MESH(bm.v, (v) => {
    if (!BMO_flag_test(bm.v, v, oflag) || BM_vert_is_edge_pair(bm, v)) return;
    BM_LOOPS_OF_VERT(bm, v).forEach((lp) => {
      if (bm.f.len[l.f[lp]] > 3 && !BMO_flag_test(bm.v, l.v[l.next[lp]], oflag) && !BMO_flag_test(bm.v, l.v[l.prev[lp]], oflag)) BM_face_split(bm, l.f[lp], l.next[lp], l.prev[lp], -1, true);
    });
    if (use_edge_delete) tear.push(v);
  });
  while (tear.length) { const v = tear.pop(); while (bm.v.e[v] >= 0) BM_edge_kill(bm, bm.v.e[v]); }
}

const killLoose = (bm) => {
  BM_ITER_MESH(bm.e, (e) => { if (bm.e.l[e] < 0 && BMO_flag_test(bm.e, e, EDGE_ISGC)) BM_edge_kill(bm, e); });
};
const killIsolated = (bm) => {
  BM_ITER_MESH(bm.v, (v) => { if (bm.v.e[v] < 0 && BMO_flag_test(bm.v, v, VERT_ISGC)) BM_vert_kill(bm, v); });
};
const joinAcross = (bm, e) => { if (!bm.e.alive[e]) return; const pair = BM_edge_loop_pair(bm, e); if (pair) BM_faces_join_pair(bm, pair[0], pair[1], false); };

// dissolve_verts: each vert goes, joining its faces into one, or straightening its two edges into one.
export function bmo_dissolve_verts_exec(bm, verts, { use_face_split = false, use_boundary_tear = false } = {}) {
  for (const v of verts) BMO_flag_enable(bm.v, v, VERT_MARK | VERT_ISGC);
  if (use_face_split) bm_face_split(bm, VERT_MARK, false);
  if (use_boundary_tear) {
    for (const v of verts) if (!BM_vert_is_edge_pair(bm, v) && BM_EDGES_OF_VERT(bm, v).some((e) => BM_edge_is_boundary(bm, e))) BMO_flag_enable(bm.v, v, VERT_MARK_TEAR);
    bm_face_split(bm, VERT_MARK_TEAR, true);
  }
  for (const v of verts) {
    let e_first = -1;
    for (const l_first of BM_LOOPS_OF_VERT(bm, v)) {
      for (const lp of loopsOfFace(bm, bm.l.f[l_first])) {
        BMO_flag_enable(bm.v, bm.l.v[lp], VERT_ISGC);
        BMO_flag_enable(bm.e, bm.l.e[lp], EDGE_ISGC);
      }
      e_first = bm.l.e[l_first];
    }
    // e_first is a face edge, so it is never the one killed.
    if (e_first >= 0) {
      let e = e_first, e_next;
      do {
        e_next = bmesh_disk_edge_next(bm, e, v);
        if (BM_edge_is_wire(bm, e)) BM_edge_kill(bm, e);
      } while ((e = e_next) !== e_first);
    }
  }
  for (const v of verts) if (BM_vert_is_edge_pair(bm, v)) BMO_flag_enable(bm.v, v, VERT_MARK_PAIR);
  for (const v of verts) if (!BMO_flag_test(bm.v, v, VERT_MARK_PAIR)) for (const e of BM_EDGES_OF_VERT(bm, v)) joinAcross(bm, e);
  killLoose(bm);
  for (const v of verts) if (BM_vert_is_edge_pair(bm, v)) bm_vert_collapse_edge_and_merge(bm, v, false);
  killIsolated(bm);
}

// The vert where a chain of two-edge verts ends, walking from v away from e, or -1 when it meets an edge flagged
// `edge_oflag`, which it flags along the way.
function bmo_find_end_of_chain(bm, e, v, edge_oflag = 0) {
  const v_init = v;
  while (BM_vert_is_edge_pair(bm, v)) {
    e = bmesh_disk_edge_next(bm, e, v);
    v = BM_edge_other_vert(bm, e, v);
    if (edge_oflag && BMO_flag_test(bm.e, e, edge_oflag)) return -1;
    BMO_flag_enable(bm.e, e, edge_oflag);
    if (v === v_init) return -1;
  }
  return v;
}

// Whether dissolving v would alter a face none of its tagged edges belong to.
function bmo_vert_touches_unselected_face(bm, v) {
  if (BMO_flag_test(bm.v, v, VERT_MARK)) return false;
  return BM_LOOPS_OF_VERT(bm, v).some((l_a) => !BMO_flag_test(bm.e, bm.l.e[l_a], EDGE_TAG) && !BMO_flag_test(bm.e, bm.l.e[BM_loop_other_edge_loop(bm, l_a, v)], EDGE_TAG));
}
const tagged_edges_count_at_most = (bm, v, oflag, max) => Math.min(BM_EDGES_OF_VERT(bm, v).filter((e) => BMO_flag_test(bm.e, e, oflag)).length, max);

// dissolve_edges: the faces on both sides of each edge join; with `use_verts` the verts left between two edges go
// too, below `angle_threshold` unless they end an edge chain.
export function bmo_dissolve_edges_exec(bm, edges, { use_verts = false, use_face_split = false, angle_threshold = Math.PI, use_preserve_quads = false } = {}) {
  const angle_epsilon = (0.0001 * 180) / Math.PI;
  use_verts = use_verts && angle_threshold > angle_epsilon;
  const dissolve_all = angle_threshold > Math.PI - angle_epsilon;
  if (use_face_split || use_verts) for (const e of edges) BMO_flag_enable(bm.e, e, EDGE_TAG);
  for (const e of edges) {
    if (BM_vert_is_edge_pair(bm, bm.e.v1[e]) || BM_vert_is_edge_pair(bm, bm.e.v2[e])) BMO_flag_enable(bm.e, e, EDGE_CHAIN);
    const faces = BM_edge_face_pair(bm, e);
    if (!faces) continue;
    for (const f of faces) for (const lp of loopsOfFace(bm, f)) { BMO_flag_enable(bm.v, bm.l.v[lp], VERT_ISGC); BMO_flag_enable(bm.e, bm.l.e[lp], EDGE_ISGC); }
    if (use_verts && BMO_flag_test(bm.e, e, EDGE_CHAIN)) {
      bmo_find_end_of_chain(bm, e, bm.e.v1[e], EDGE_TAG);
      bmo_find_end_of_chain(bm, e, bm.e.v2[e], EDGE_TAG);
    }
  }
  if (use_verts) {
    for (const e of edges) {
      const faces = BM_edge_face_pair(bm, e);
      if (!faces) continue;
      for (let v_edge of [bm.e.v1[e], bm.e.v2[e]]) {
        // Two triangles join into a quad without losing a corner.
        if (use_preserve_quads && bm.f.len[faces[0]] === 3 && bm.f.len[faces[1]] === 3 && tagged_edges_count_at_most(bm, v_edge, EDGE_TAG, 2) === 1) continue;
        if (BM_vert_is_edge_pair(bm, v_edge)) v_edge = bmo_find_end_of_chain(bm, e, v_edge, EDGE_CHAIN);
        if (v_edge < 0) continue;
        if (bmo_vert_touches_unselected_face(bm, v_edge) && tagged_edges_count_at_most(bm, v_edge, EDGE_TAG, 2) !== 1) continue;
        BMO_flag_enable(bm.v, v_edge, VERT_MARK);
      }
    }
  }
  if (use_face_split) {
    BM_ITER_MESH(bm.v, (v) => { if (BM_EDGES_OF_VERT(bm, v).filter((e) => !BMO_flag_test(bm.e, e, EDGE_TAG)).length <= 2) BMO_flag_enable(bm.v, v, VERT_TAG); });
    bm_face_split(bm, VERT_TAG, false);
  }
  for (const e of edges) joinAcross(bm, e);
  killLoose(bm);
  killIsolated(bm);
  if (!use_verts) return;
  BM_ITER_MESH(bm.v, (v) => {
    if (!BMO_flag_test(bm.v, v, VERT_MARK)) return;
    const pair = BM_vert_edge_pair(bm, v);
    if (!pair) { BMO_flag_disable(bm.v, v, VERT_MARK); return; }
    if (dissolve_all || pair.some((e) => BMO_flag_test(bm.e, e, EDGE_CHAIN))) return;
    if (bmo_vert_calc_edge_angle_blended(bm, v) > angle_threshold - angle_epsilon) BMO_flag_disable(bm.v, v, VERT_MARK);
  });
  BM_ITER_MESH(bm.v, (v) => { if (BMO_flag_test(bm.v, v, VERT_MARK) && BM_vert_is_edge_pair(bm, v)) bm_vert_collapse_edge_and_merge(bm, v, true); });
}
