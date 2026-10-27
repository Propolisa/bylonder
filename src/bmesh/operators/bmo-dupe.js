// Duplicate, split and delete operators (bmo_dupe.cc).
import { BM_ITER_MESH, BM_VERT, BM_EDGE, BMO_flag_test, BMO_flag_enable } from '../intern/bmesh-class.js';
import { BM_vert_create, BM_edge_create, BM_face_create, BM_CREATE_SKIP_CD } from '../intern/bmesh-core.js';
import { BM_elem_attrs_copy } from '../intern/bmesh-construct.js';
import { BM_edge_is_boundary } from '../intern/bmesh-query.js';
import { BM_edge_verts_swap } from '../intern/bmesh-mods.js';
import { BMO_mesh_delete_oflag_context } from '../intern/bmesh-delete.js';

const DUPE_INPUT = 1, DUPE_NEW = 2, DUPE_DONE = 4, DEL_INPUT = 1;
const POOLS = ['v', 'e', 'f'];

const loopsOf = (bm, f) => { const out = [], first = bm.f.l_first[f]; let l = first; do out.push(l); while ((l = bm.l.next[l]) !== first); return out; };
const facesOfVert = (bm, v, fn) => {
  const first = bm.v.e[v];
  if (first < 0) return false;
  let e = first;
  do {
    const l0 = bm.e.l[e];
    if (l0 >= 0) { let l = l0; do if (fn(bm.l.f[l])) return true; while ((l = bm.l.radial_next[l]) !== l0); }
  } while ((e = bm.e[bm.e.v1[e] === v ? 'v1_disk_link_next' : 'v2_disk_link_next'][e]) !== first);
  return false;
};
const edgesOfVert = (bm, v, fn) => {
  const first = bm.v.e[v];
  if (first < 0) return false;
  let e = first;
  do if (fn(e)) return true; while ((e = bm.e[bm.e.v1[e] === v ? 'v1_disk_link_next' : 'v2_disk_link_next'][e]) !== first);
  return false;
};

// bmo_duplicate_exec within one BMesh. `geom` is { v, e, f }. Maps are Maps in insertion order; vert, edge and face
// maps hold both directions, like Blender's slot maps. Run through bmo_call.
export function bmo_duplicate_exec(bm, geom, { use_select_history = false, use_edge_flip_from_face = false } = {}) {
  for (const pool of POOLS) for (const i of geom[pool] ?? []) BMO_flag_enable(bm[pool], i, DUPE_INPUT);
  const out = { vert_map: new Map(), edge_map: new Map(), face_map: new Map(), boundary_map: new Map(), isovert_map: new Map() };

  const vertCopy = (v) => {
    const v_dst = BM_vert_create(bm, bm.v.co.subarray(v * 3, v * 3 + 3), -1, BM_CREATE_SKIP_CD);
    out.vert_map.set(v, v_dst).set(v_dst, v);
    BM_elem_attrs_copy(bm.v, v, v_dst);
    BMO_flag_enable(bm.v, v_dst, DUPE_NEW);
    BMO_flag_enable(bm.v, v, DUPE_DONE);
    return v_dst;
  };
  const edgeCopy = (e) => {
    let rlen = 0;
    const l0 = bm.e.l[e];
    if (l0 >= 0) { let l = l0; do if (BMO_flag_test(bm.f, bm.l.f[l], DUPE_INPUT)) rlen++; while ((l = bm.l.radial_next[l]) !== l0); }
    const e_dst = BM_edge_create(bm, out.vert_map.get(bm.e.v1[e]), out.vert_map.get(bm.e.v2[e]), -1, BM_CREATE_SKIP_CD);
    out.edge_map.set(e, e_dst).set(e_dst, e);
    if (rlen < 2) out.boundary_map.set(e, e_dst);
    BM_elem_attrs_copy(bm.e, e, e_dst);
    BMO_flag_enable(bm.e, e_dst, DUPE_NEW);
    if (use_edge_flip_from_face && BM_edge_is_boundary(bm, e) && bm.l.v[bm.e.l[e]] === bm.e.v1[e]) BM_edge_verts_swap(bm, e_dst);
    BMO_flag_enable(bm.e, e, DUPE_DONE);
  };
  const faceCopy = (f) => {
    const loops = loopsOf(bm, f);
    const f_dst = BM_face_create(bm, loops.map((l) => out.vert_map.get(bm.l.v[l])), loops.map((l) => out.edge_map.get(bm.l.e[l])), loops.length, -1, BM_CREATE_SKIP_CD);
    out.face_map.set(f, f_dst).set(f_dst, f);
    BM_elem_attrs_copy(bm.f, f, f_dst);
    loopsOf(bm, f_dst).forEach((l_dst, i) => BM_elem_attrs_copy(bm.l, loops[i], l_dst));
    BMO_flag_enable(bm.f, f_dst, DUPE_NEW);
    BMO_flag_enable(bm.f, f, DUPE_DONE);
  };

  BM_ITER_MESH(bm.v, (v) => {
    if (!BMO_flag_test(bm.v, v, DUPE_INPUT) || BMO_flag_test(bm.v, v, DUPE_DONE)) return;
    const v_dst = vertCopy(v);
    const isolated = !facesOfVert(bm, v, (f) => BMO_flag_test(bm.f, f, DUPE_INPUT)) && !edgesOfVert(bm, v, (e) => BMO_flag_test(bm.e, e, DUPE_INPUT));
    if (isolated) out.isovert_map.set(v, v_dst);
  });
  BM_ITER_MESH(bm.e, (e) => {
    if (!BMO_flag_test(bm.e, e, DUPE_INPUT) || BMO_flag_test(bm.e, e, DUPE_DONE)) return;
    for (const v of [bm.e.v1[e], bm.e.v2[e]]) if (!BMO_flag_test(bm.v, v, DUPE_DONE)) vertCopy(v);
    edgeCopy(e);
  });
  BM_ITER_MESH(bm.f, (f) => {
    if (!BMO_flag_test(bm.f, f, DUPE_INPUT)) return;
    for (const l of loopsOf(bm, f)) if (!BMO_flag_test(bm.v, bm.l.v[l], DUPE_DONE)) vertCopy(bm.l.v[l]);
    for (const l of loopsOf(bm, f)) if (!BMO_flag_test(bm.e, bm.l.e[l], DUPE_DONE)) edgeCopy(bm.l.e[l]);
    faceCopy(f);
  });
  if (use_select_history) BMO_mesh_selected_remap(bm, out);

  out.geom_out = Object.fromEntries(POOLS.map((pool) => {
    const list = [];
    BM_ITER_MESH(bm[pool], (i) => BMO_flag_test(bm[pool], i, DUPE_NEW) && list.push(i));
    return [pool, list];
  }));
  return out;
}

// BMO_mesh_selected_remap: the select history and active face follow the maps; unmapped entries drop out.
export function BMO_mesh_selected_remap(bm, { vert_map, edge_map, face_map }) {
  const mapOf = (htype) => (htype === BM_VERT ? vert_map : htype === BM_EDGE ? edge_map : face_map);
  bm.selected = (bm.selected ?? []).map(({ htype, ele }) => ({ htype, ele: mapOf(htype).get(ele) ?? -1 })).filter(({ ele }) => ele >= 0);
  if (bm.act_face >= 0 && face_map.has(bm.act_face)) bm.act_face = face_map.get(bm.act_face);
}

// delete: `geom` is { v, e, f } element lists. Run through bmo_call.
export function bmo_delete_exec(bm, geom, context) {
  for (const pool of POOLS) for (const i of geom[pool] ?? []) BMO_flag_enable(bm[pool], i, DEL_INPUT);
  BMO_mesh_delete_oflag_context(bm, DEL_INPUT, context);
}
