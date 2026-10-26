// Extrude operators (bmo_extrude.cc).
import { BM_ITER_MESH, BM_VERT, BM_ELEM_HIDDEN, BM_ELEM_SEAM, BM_ELEM_SMOOTH, BMO_flag_test, BMO_flag_enable, BM_elem_flag_disable } from '../intern/bmesh-class.js';
import { BM_vert_create, BM_edge_create, BM_face_create, BM_elem_attrs_copy, BM_CREATE_NOP, BM_CREATE_NO_DOUBLE } from '../intern/bmesh-core.js';
import { BM_face_create_verts } from '../intern/bmesh-construct.js';
import { BM_edge_exists, BM_edge_is_boundary, BM_edge_other_loop, BM_vert_is_wire_endpoint } from '../intern/bmesh-query.js';
import { bmesh_disk_edge_next } from '../intern/bmesh-structure.js';
import { BM_face_normal_flip } from '../intern/bmesh-polygon.js';
import { BMO_op_callf } from '../intern/bmesh-operators.js';
import { DEL_ONLYTAGGED } from '../intern/bmesh-delete.js';
import { bmo_duplicate_exec, bmo_delete_exec } from './bmo-dupe.js';

const EXT_INPUT = 1, EXT_KEEP = 2, EXT_DEL = 4;
const POOLS = ['v', 'e', 'f'];

const radialFaces = (bm, e, fn) => { const l0 = bm.e.l[e]; if (l0 < 0) return false; let l = l0; do if (fn(bm.l.f[l])) return true; while ((l = bm.l.radial_next[l]) !== l0); return false; };
const diskEdges = (bm, v, fn) => { const e0 = bm.v.e[v]; if (e0 < 0) return false; let e = e0; do if (fn(e)) return true; while ((e = bmesh_disk_edge_next(bm, e, v)) !== e0); return false; };
const flagged = (bm, oflag) => Object.fromEntries(POOLS.map((pool) => { const list = []; BM_ITER_MESH(bm[pool], (i) => BMO_flag_test(bm[pool], i, oflag) && list.push(i)); return [pool, list]; }));

function bm_extrude_copy_face_loop_attributes(bm, f) {
  const { l } = bm;
  const l0 = bm.f.l_first[f], l1 = l.next[l0], l2 = l.next[l1], l3 = l.next[l2];
  if (l0 === l.radial_next[l0]) return;
  const other0 = BM_edge_other_loop(bm, l.e[l0], l0), other1 = BM_edge_other_loop(bm, l.e[l0], l1);
  BM_elem_attrs_copy(bm.f, l.f[other0], f);
  BM_elem_flag_disable(bm.f, f, BM_ELEM_HIDDEN);
  BM_elem_attrs_copy(bm.l, other0, l0);
  BM_elem_attrs_copy(bm.l, other0, l3);
  BM_elem_attrs_copy(bm.l, other1, l1);
  BM_elem_attrs_copy(bm.l, other1, l2);
}

// Seam and smooth flags a new side edge takes from the face edges around `v`: [enable, disable], or null.
function bm_extrude_region_edge_flag(bm, v) {
  let any = 0, all = 0xff, ok = false;
  diskEdges(bm, v, (e) => {
    if (bm.e.l[e] >= 0 && !BM_edge_is_boundary(bm, e)) { any |= bm.e.hflag[e]; all &= bm.e.hflag[e]; ok = true; }
  });
  return ok ? [any & BM_ELEM_SEAM, BM_ELEM_SMOOTH & ~all] : null;
}

function sideEdge(bm, v_a, v_b, v_flag) {
  const existing = BM_edge_exists(bm, v_a, v_b);
  if (existing >= 0) return existing;
  const flags = bm_extrude_region_edge_flag(bm, v_flag);
  const e = BM_edge_create(bm, v_a, v_b, -1, BM_CREATE_NOP);
  if (flags) bm.e.hflag[e] = (bm.e.hflag[e] | flags[0]) & ~flags[1];
  return e;
}

// extrude_face_region: `geom` is { v, e, f }. Returns geom.out. Run through BMO_op_callf.
export function bmo_extrude_face_region_exec(bm, geom, { use_normal_flip = false, use_select_history = false, use_keep_orig = false, skip_input_flip = false } = {}) {
  for (const e of geom.e ?? []) BMO_flag_enable(bm.e, e, EXT_INPUT);
  for (const f of geom.f ?? []) BMO_flag_enable(bm.f, f, EXT_INPUT);
  let delorig = false;
  if (!use_keep_orig) {
    BM_ITER_MESH(bm.e, (e) => {
      if (!BMO_flag_test(bm.e, e, EXT_INPUT)) return;
      let count = 0;
      const found = radialFaces(bm, e, (f) => { if (!BMO_flag_test(bm.f, f, EXT_INPUT)) return true; count++; return false; });
      if (found) delorig = true;
      else if (count > 1) BMO_flag_enable(bm.e, e, EXT_DEL);
    });
  }
  BM_ITER_MESH(bm.v, (v) => {
    if (bm.v.e[v] < 0) return;
    const keep = diskEdges(bm, v, (e) => !BMO_flag_test(bm.e, e, EXT_INPUT) || !BMO_flag_test(bm.e, e, EXT_DEL)) ||
      diskEdges(bm, v, (e) => radialFaces(bm, e, (f) => !BMO_flag_test(bm.f, f, EXT_INPUT)));
    if (!keep) BMO_flag_enable(bm.v, v, EXT_DEL);
  });
  BM_ITER_MESH(bm.f, (f) => BMO_flag_test(bm.f, f, EXT_INPUT) && BMO_flag_enable(bm.f, f, EXT_DEL));
  const del = delorig && flagged(bm, EXT_DEL);

  const dupe = BMO_op_callf(bm, bmo_duplicate_exec, geom, { use_select_history });
  if (bm.act_face >= 0 && BMO_flag_test(bm.f, bm.act_face, EXT_INPUT)) bm.act_face = dupe.face_map.get(bm.act_face) ?? -1;
  if (del) BMO_op_callf(bm, bmo_delete_exec, del, DEL_ONLYTAGGED);
  if (!delorig && !skip_input_flip) BM_ITER_MESH(bm.f, (f) => BMO_flag_test(bm.f, f, EXT_INPUT) && BM_face_normal_flip(bm, f));

  for (const [e, e_new] of dupe.boundary_map) {
    const flip = !(bm.e.l[e_new] >= 0 ? bm.l.v[bm.e.l[e_new]] === bm.e.v1[e_new] : bm.e.l[e] < 0 || bm.l.v[bm.e.l[e]] !== bm.e.v1[e]);
    const verts = flip === use_normal_flip ? [bm.e.v1[e], bm.e.v2[e], bm.e.v2[e_new], bm.e.v1[e_new]] : [bm.e.v2[e], bm.e.v1[e], bm.e.v1[e_new], bm.e.v2[e_new]];
    const edges = [e, sideEdge(bm, verts[1], verts[2], verts[2]), e_new, sideEdge(bm, verts[3], verts[0], verts[3])];
    bm_extrude_copy_face_loop_attributes(bm, BM_face_create(bm, verts, edges, 4, -1, BM_CREATE_NOP));
  }
  for (let [v, v2] of dupe.isovert_map) {
    if (BM_vert_is_wire_endpoint(bm, v) && bm.e.v1[bm.v.e[v]] === v) [v, v2] = [v2, v];
    BM_edge_create(bm, v, v2, -1, BM_CREATE_NO_DOUBLE);
  }
  return dupe.geom_out;
}

// extrude_edge_only: returns geom.out. Run through BMO_op_callf.
export function bmo_extrude_edge_only_exec(bm, edges, { use_normal_flip = false, use_select_history = false } = {}) {
  for (const e of edges) {
    BMO_flag_enable(bm.e, e, EXT_INPUT);
    BMO_flag_enable(bm.v, bm.e.v1[e], EXT_INPUT);
    BMO_flag_enable(bm.v, bm.e.v2[e], EXT_INPUT);
  }
  const dupe = BMO_op_callf(bm, bmo_duplicate_exec, flagged(bm, EXT_INPUT), { use_select_history });
  for (let [e, e_new] of dupe.boundary_map) {
    const flip = !(bm.e.l[e] >= 0 && bm.e.v1[e] !== bm.l.v[bm.e.l[e]]);
    const verts = flip === use_normal_flip ? [bm.e.v1[e], bm.e.v2[e], bm.e.v2[e_new], bm.e.v1[e_new]] : [bm.e.v2[e], bm.e.v1[e], bm.e.v1[e_new], bm.e.v2[e_new]];
    const f = BM_face_create_verts(bm, verts, -1, BM_CREATE_NOP, true);
    bm_extrude_copy_face_loop_attributes(bm, f);
    if (BMO_flag_test(bm.e, e, EXT_INPUT)) e = e_new;
    BMO_flag_enable(bm.f, f, EXT_KEEP);
    BMO_flag_enable(bm.e, e, EXT_KEEP);
    BMO_flag_enable(bm.v, bm.e.v1[e], EXT_KEEP);
    BMO_flag_enable(bm.v, bm.e.v2[e], EXT_KEEP);
  }
  return flagged(bm, EXT_KEEP);
}

// extrude_vert_indiv: returns { verts, edges } out. Run through BMO_op_callf.
export function bmo_extrude_vert_indiv_exec(bm, verts, { use_select_history = false } = {}) {
  for (let v of verts) {
    let dupev = BM_vert_create(bm, bm.v.co.subarray(v * 3, v * 3 + 3), v, BM_CREATE_NOP);
    BMO_flag_enable(bm.v, dupev, EXT_KEEP);
    if (use_select_history) for (const ese of bm.selected ?? []) if (ese.htype === BM_VERT && ese.ele === v) ese.ele = dupev;
    if (BM_vert_is_wire_endpoint(bm, v) && bm.e.v1[bm.v.e[v]] === v) [v, dupev] = [dupev, v];
    BMO_flag_enable(bm.e, BM_edge_create(bm, v, dupev, -1, BM_CREATE_NOP), EXT_KEEP);
  }
  const out = flagged(bm, EXT_KEEP);
  return { v: out.v, e: out.e };
}
