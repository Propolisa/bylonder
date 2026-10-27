// Edit Mode mesh operators (editmesh_tools.cc).
import { BM_ITER_MESH, BM_ELEM_SELECT, BM_ELEM_TAG, BM_ELEM_HIDDEN, BM_ELEM_SMOOTH, BM_VERT, BM_EDGE, BM_FACE, BM_elem_flag_test, BM_elem_flag_disable } from '../../bmesh/intern/bmesh-class.js';
import { bmo_pointmerge_exec, bmo_collapse_exec, bmo_remove_doubles_exec } from '../../bmesh/operators/bmo-removedoubles.js';
import { add_v3, mul_v3_fl } from '../../blenlib/math-geom.js';
import { bmo_extrude_face_region_exec, bmo_extrude_edge_only_exec, bmo_extrude_vert_indiv_exec } from '../../bmesh/operators/bmo-extrude.js';
import { bmo_call } from '../../bmesh/intern/bmesh-operators.js';
import { DEL_VERTS, DEL_EDGES, DEL_FACES, DEL_EDGESFACES, DEL_ONLYFACES } from '../../bmesh/intern/bmesh-delete.js';
import { bmo_delete_exec } from '../../bmesh/operators/bmo-dupe.js';
import { bmo_dissolve_faces_exec, bmo_dissolve_verts_exec, bmo_dissolve_edges_exec } from '../../bmesh/operators/bmo-dissolve.js';
import { BM_mesh_elem_hflag_disable_all, BM_mesh_elem_hflag_enable_test, BM_mesh_select_mode_flush_ex, BM_face_select_set, BM_edge_select_set, BM_vert_select_set, BM_elem_select_set, BM_select_history_clear, BM_select_history_store, SCE_SELECT_VERTEX, SCE_SELECT_EDGE } from '../../bmesh/intern/bmesh-marking.js';
import { BM_mesh_esubdivide, SUBD_CORNER_INNERVERT, SUBD_CORNER_PATH, SUBD_CORNER_FAN, SUBD_CORNER_STRAIGHT_CUT, SUBDIV_SELECT_ORIG } from '../../bmesh/operators/bmo-subdivide.js';
import { edbm_loopcut } from './editmesh-loopcut.js';
import { edbm_select_loop, edbm_select_linked_exec } from './editmesh-select.js';
import { bmo_inset_region_exec } from '../../bmesh/operators/bmo-inset.js';
import { edge_slide_exec } from '../transform/transform-mesh-edge-slide.js';
import { BM_EDGES_OF_VERT, BM_edge_exists, BM_edge_other_vert, BM_edge_is_wire, BM_edge_is_boundary, BM_edge_share_face_check, BM_face_vert_share_loop, BM_face_edge_share_loop } from '../../bmesh/intern/bmesh-query.js';
import { BM_edge_at_index } from '../../bmesh/intern/bmesh-mesh.js';
import { bmo_contextual_create_exec } from '../../bmesh/operators/bmo-create.js';
import { EDBM_mesh_hide, EDBM_mesh_reveal, EDBM_select_more, EDBM_select_less } from './editmesh-utils.js';
import { edbm_bevel_exec } from './editmesh-bevel.js';
import { BM_mesh_bm_from_me, BM_mesh_bm_to_me } from '../../bmesh/intern/bmesh-mesh-convert.js';
import { editMeshFromMesh, editMeshFree, meshFromEditMesh, runOperator } from '../../bmesh/bmesh-wasm.js';

// The %hv, %he and %hf operator slots: elements with a header flag.
export function BMO_slot_buffer_from_hflag(bm, pool, hflag) {
  const out = [];
  BM_ITER_MESH(bm[pool], (i) => { if (BM_elem_flag_test(bm[pool], i, hflag)) out.push(i); });
  return { [pool]: out };
}

const MESH_DELETE = {
  VERT: ['v', DEL_VERTS],
  EDGE: ['e', DEL_EDGES],
  FACE: ['f', DEL_FACES],
  EDGE_FACE: ['e', DEL_EDGESFACES],
  ONLY_FACE: ['f', DEL_ONLYFACES],
};

// mesh.delete
export function edbm_delete_exec(bm, type = 'VERT') {
  const [pool, context] = MESH_DELETE[type];
  bmo_call(bm, bmo_delete_exec, BMO_slot_buffer_from_hflag(bm, pool, BM_ELEM_SELECT), context);
  BM_mesh_elem_hflag_disable_all(bm, BM_VERT | BM_EDGE | BM_FACE, BM_ELEM_SELECT);
}

// mesh.dissolve_faces: the joined faces end up selected.
export function edbm_dissolve_faces_exec(bm) {
  const region = bmo_call(bm, bmo_dissolve_faces_exec, BMO_slot_buffer_from_hflag(bm, 'f', BM_ELEM_SELECT).f);
  for (const f of region) BM_face_select_set(bm, f, true);
}

// geom slots from header flags, for the element types in `htype`.
const geomFromHflag = (bm, htype, hflag) => ({
  v: htype & BM_VERT ? BMO_slot_buffer_from_hflag(bm, 'v', hflag).v : [],
  e: htype & BM_EDGE ? BMO_slot_buffer_from_hflag(bm, 'e', hflag).e : [],
  f: htype & BM_FACE ? BMO_slot_buffer_from_hflag(bm, 'f', hflag).f : [],
});
const selectGeom = (bm, geom) => [[BM_VERT, geom.v], [BM_EDGE, geom.e], [BM_FACE, geom.f]].forEach(([htype, list]) => list?.forEach((ele) => BM_elem_select_set(bm, htype, ele, true)));
// Clears the selection, keeping the select history for the operator to remap.
const deselectKeepHistory = (bm) => { const history = bm.selected; BM_mesh_elem_hflag_disable_all(bm, BM_VERT | BM_EDGE | BM_FACE, BM_ELEM_SELECT); bm.selected = history; };

function edbm_extrude_htype_from_em_select(bm, selectmode) {
  let htype = BM_VERT | BM_EDGE | BM_FACE;
  if (!(selectmode & SCE_SELECT_VERTEX)) htype &= selectmode & SCE_SELECT_EDGE ? ~BM_VERT : ~(BM_VERT | BM_EDGE);
  if (bm.totedgesel === 0) htype &= ~(BM_EDGE | BM_FACE);
  else if (bm.totfacesel === 0) htype &= ~BM_FACE;
  return htype;
}

function edbm_extrude_ex(bm, htype, { use_normal_flip = false } = {}) {
  if (htype & BM_FACE) htype |= BM_EDGE;
  const geom = geomFromHflag(bm, htype, BM_ELEM_SELECT);
  deselectKeepHistory(bm);
  selectGeom(bm, bmo_call(bm, bmo_extrude_face_region_exec, geom, { use_normal_flip, use_select_history: true }));
}

function edbm_extrude_edges_indiv(bm, { use_normal_flip = false } = {}) {
  const edges = BMO_slot_buffer_from_hflag(bm, 'e', BM_ELEM_SELECT).e;
  deselectKeepHistory(bm);
  const out = bmo_call(bm, bmo_extrude_edge_only_exec, edges, { use_normal_flip, use_select_history: true });
  selectGeom(bm, { v: out.v, e: out.e });
}

function edbm_extrude_verts_indiv(bm) {
  const verts = BMO_slot_buffer_from_hflag(bm, 'v', BM_ELEM_SELECT).v;
  for (const v of verts) BM_vert_select_set(bm, v, false);
  bmo_call(bm, bmo_extrude_vert_indiv_exec, verts, { use_select_history: true }).v.forEach((v) => BM_vert_select_set(bm, v, true));
}

// mesh.extrude_region: region extrude, or each vertex or edge on its own when nothing else is selected. Returns
// false for a selection with nothing to extrude.
export function edbm_extrude_mesh(bm, props = {}) {
  const { selectmode } = bm;
  const htype = edbm_extrude_htype_from_em_select(bm, selectmode);
  let nr;
  if (selectmode & SCE_SELECT_VERTEX) nr = !bm.totvertsel ? 'NONE' : bm.totvertsel === 1 || !bm.totedgesel ? 'VERT_ONLY' : 'ELEM_FLAG';
  else if (selectmode & SCE_SELECT_EDGE) nr = !bm.totedgesel ? 'NONE' : !bm.totfacesel ? 'EDGE_ONLY' : 'ELEM_FLAG';
  else nr = bm.totfacesel ? 'ELEM_FLAG' : 'NONE';
  if (nr === 'ELEM_FLAG') edbm_extrude_ex(bm, htype, props);
  else if (nr === 'VERT_ONLY') edbm_extrude_verts_indiv(bm);
  else if (nr === 'EDGE_ONLY') edbm_extrude_edges_indiv(bm, props);
  return nr !== 'NONE';
}

// Runs Blender's own operator (src/bmesh/bmesh-wasm.js) on the edit mesh: it goes into WebAssembly with its UV map and
// flags, the operator runs as Blender runs it, and the result replaces the edit mesh.
function blenderOperator(idname) {
  return (bm, props) => {
    const edit = editMeshFromMesh(BM_mesh_bm_to_me(bm), bm.selectmode);
    try {
      runOperator(edit, idname, props);
      const { selectmode } = bm;
      Object.defineProperties(bm, Object.getOwnPropertyDescriptors(BM_mesh_bm_from_me(meshFromEditMesh(edit))));
      bm.selectmode = selectmode;
    } finally {
      editMeshFree(edit);
    }
  };
}

// mesh.inset (Inset Faces; individual insets are not ported yet).
export function edbm_inset_exec(bm, { use_boundary = true, use_even_offset = true, use_relative_offset = false, use_edge_rail = false, thickness = 0, depth = 0, use_outset = false, use_select_inset = false } = {}) {
  const faces = BMO_slot_buffer_from_hflag(bm, 'f', BM_ELEM_SELECT).f;
  if (!faces.length) return false;
  const out = bmo_call(bm, bmo_inset_region_exec, faces, { use_boundary, use_even_offset, use_relative_offset, use_edge_rail, thickness, depth, use_outset });
  BM_mesh_elem_hflag_disable_all(bm, BM_VERT | BM_EDGE | BM_FACE, BM_ELEM_SELECT);
  for (const f of use_select_inset ? out : faces) BM_face_select_set(bm, f, true);
  return true;
}

const QUAD_CORNER = { INNERVERT: SUBD_CORNER_INNERVERT, PATH: SUBD_CORNER_PATH, STRAIGHT_CUT: SUBD_CORNER_STRAIGHT_CUT, FAN: SUBD_CORNER_FAN };

// mesh.subdivide (smoothness and fractal are not ported yet).
export function edbm_subdivide_exec(bm, { number_cuts = 1, smoothness = 0, ngon = true, quadcorner = 'STRAIGHT_CUT' } = {}) {
  if (!(bm.totedgesel || bm.totfacesel)) return false;
  const use_quad_tri = !ngon;
  const corner = use_quad_tri && quadcorner === 'STRAIGHT_CUT' ? 'INNERVERT' : quadcorner;
  BM_mesh_esubdivide(bm, { seltype: SUBDIV_SELECT_ORIG, cuts: number_cuts, smooth: smoothness, quad_corner_type: QUAD_CORNER[corner], use_single_edge: use_quad_tri, use_grid_fill: true });
  return true;
}

const selectedVerts = (bm) => BMO_slot_buffer_from_hflag(bm, 'v', BM_ELEM_SELECT).v;
const co = (bm, v) => [...bm.v.co.subarray(v * 3, v * 3 + 3)];

// mesh.merge: CENTER, CURSOR (`cursor` in object space), COLLAPSE, FIRST or LAST (by the selection history).
export function edbm_merge_exec(bm, { type = 'CENTER', cursor = [0, 0, 0] } = {}) {
  if (!bm.totvertsel) return false;
  const verts = selectedVerts(bm);
  if (type === 'COLLAPSE') bmo_call(bm, bmo_collapse_exec, { edges: BMO_slot_buffer_from_hflag(bm, 'e', BM_ELEM_SELECT).e });
  else if (type === 'FIRST' || type === 'LAST') {
    const ese = type === 'FIRST' ? bm.selected[0] : bm.selected.at(-1);
    if (ese?.htype !== BM_VERT || !BM_elem_flag_test(bm.v, ese.ele, BM_ELEM_SELECT)) return false;
    bmo_call(bm, bmo_pointmerge_exec, { verts, merge_co: co(bm, ese.ele), vert_target: ese.ele });
  } else {
    const merge_co = type === 'CURSOR' ? cursor : mul_v3_fl(verts.reduce((sum, v) => add_v3(sum, co(bm, v)), [0, 0, 0]), 1 / verts.length);
    bmo_call(bm, bmo_pointmerge_exec, { verts, merge_co });
  }
  // Once collapsed there is no edge or face selection.
  if (!(bm.selectmode & SCE_SELECT_VERTEX)) BM_mesh_elem_hflag_disable_all(bm, BM_VERT | BM_EDGE | BM_FACE, BM_ELEM_SELECT);
  return true;
}

// mesh.remove_doubles (Merge by Distance): returns how many verts were removed.
export function edbm_remove_doubles_exec(bm, { threshold = 0.0001, use_centroid = true } = {}) {
  if (!bm.totvertsel) return 0;
  const [pool, htype] = bm.selectmode & SCE_SELECT_VERTEX ? ['v', BM_VERT] : bm.selectmode & SCE_SELECT_EDGE ? ['e', BM_EDGE] : ['f', BM_FACE];
  // The selection survives the weld as tags.
  BM_mesh_elem_hflag_enable_test(bm, htype, BM_ELEM_TAG, true, true, BM_ELEM_SELECT);
  const count = bmo_call(bm, bmo_remove_doubles_exec, { verts: selectedVerts(bm), dist: threshold, use_centroid });
  BM_mesh_elem_hflag_enable_test(bm, htype, BM_ELEM_SELECT, true, true, BM_ELEM_TAG);
  BM_mesh_select_mode_flush_ex(bm, bm.selectmode);
  return count;
}

// USE_FACE_CREATE_SEL_EXTEND: one selected vert (or edge) on a boundary or wire grows the selection to its two
// neighbouring edges, so pressing F again and again keeps filling. Returns the element to deselect afterwards.
function add_edge_face_tricky_extend_sel(bm) {
  const lookup = (v, e_used, max, test) => BM_EDGES_OF_VERT(bm, v).filter((e) => !BM_elem_flag_test(bm.e, e, BM_ELEM_HIDDEN) && e !== e_used && test(bm, e)).slice(0, max);
  const tests = [BM_edge_is_wire, BM_edge_is_boundary];
  if (bm.totvertsel === 1 && !bm.totedgesel && !bm.totfacesel) {
    const v = selectedVerts(bm)[0];
    for (const test of tests) {
      const pair = lookup(v, -1, 3, test);
      if (pair.length !== 2 || BM_edge_share_face_check(bm, pair[0], pair[1])) continue;
      const e_other = BM_edge_exists(bm, BM_edge_other_vert(bm, pair[0], v), BM_edge_other_vert(bm, pair[1], v));
      for (const e of [...pair, e_other]) if (e >= 0) BM_edge_select_set(bm, e, true);
      return { htype: BM_VERT, ele: v };
    }
  } else if (bm.totvertsel === 2 && bm.totedgesel === 1 && !bm.totfacesel) {
    const e = BMO_slot_buffer_from_hflag(bm, 'e', BM_ELEM_SELECT).e[0], v1 = bm.e.v1[e], v2 = bm.e.v2[e];
    for (const [t1, t2] of [[0, 0], [0, 1], [1, 0], [1, 1]]) {
      const p1 = lookup(v1, e, 2, tests[t1]), p2 = lookup(v2, e, 2, tests[t2]);
      if (p1.length !== 1 || p2.length !== 1 || BM_edge_share_face_check(bm, e, p1[0]) || BM_edge_share_face_check(bm, e, p2[0])) continue;
      const v1_other = BM_edge_other_vert(bm, p1[0], v1), v2_other = BM_edge_other_vert(bm, p2[0], v2);
      const e_other = v1_other !== v2_other ? BM_edge_exists(bm, v1_other, v2_other) : -1;
      for (const s of [p1[0], p2[0], e_other]) if (s >= 0) BM_edge_select_set(bm, s, true);
      return { htype: BM_EDGE, ele: e };
    }
  }
  return null;
}

// The new face stays unselected and the edge (or vert) across from the starting element becomes active.
function add_edge_face_tricky_finalize_sel(bm, desel, f) {
  BM_select_history_clear(bm);
  BM_elem_flag_disable(bm.f, f, BM_ELEM_HIDDEN);
  BM_face_select_set(bm, f, false);
  const { l } = bm;
  if (desel.htype === BM_VERT) {
    const lp = BM_face_vert_share_loop(bm, f, desel.ele);
    BM_vert_select_set(bm, desel.ele, false);
    BM_edge_select_set(bm, l.e[l.next[lp]], true);
    BM_select_history_store(bm, BM_EDGE, l.e[l.next[lp]]);
    return;
  }
  const lp = BM_face_edge_share_loop(bm, f, desel.ele);
  BM_edge_select_set(bm, desel.ele, false);
  const [htype, ele] = bm.f.len[f] === 4 ? [BM_EDGE, l.e[l.next[l.next[lp]]]] : [BM_VERT, l.v[l.next[l.next[lp]]]];
  const pool = htype === BM_EDGE ? bm.e : bm.v;
  BM_elem_flag_disable(pool, ele, BM_ELEM_HIDDEN);
  BM_elem_select_set(bm, htype, ele, true);
  BM_select_history_store(bm, htype, ele);
}

// mesh.edge_face_add (Fill, F): an edge, faces, a dissolve or an n-gon from the selection, as contextual_create
// decides. New faces are smooth when most selected edges' faces are.
export function edbm_add_edge_face_exec(bm) {
  if (!bm.totvertsel && !bm.totedgesel && !bm.totfacesel) return false;
  const smooth = [0, 0];
  BM_ITER_MESH(bm.e, (e) => { if (BM_elem_flag_test(bm.e, e, BM_ELEM_SELECT) && bm.e.l[e] >= 0) smooth[BM_elem_flag_test(bm.f, bm.l.f[bm.e.l[e]], BM_ELEM_SMOOTH) ? 1 : 0]++; });
  const totedge = bm.totedge, totface = bm.totface;
  const desel = add_edge_face_tricky_extend_sel(bm);
  const geom = { verts: selectedVerts(bm), edges: BMO_slot_buffer_from_hflag(bm, 'e', BM_ELEM_SELECT).e, faces: BMO_slot_buffer_from_hflag(bm, 'f', BM_ELEM_SELECT).f };
  const out = bmo_call(bm, bmo_contextual_create_exec, { geom, use_smooth: smooth[0] < smooth[1] });
  if (totedge === bm.totedge && totface === bm.totface) return false;
  if (desel && out.faces.length === 1) add_edge_face_tricky_finalize_sel(bm, desel, out.faces[0]);
  else {
    for (const f of out.faces) { BM_elem_flag_disable(bm.f, f, BM_ELEM_HIDDEN); BM_face_select_set(bm, f, true); }
    for (const e of out.edges) { BM_elem_flag_disable(bm.e, e, BM_ELEM_HIDDEN); BM_edge_select_set(bm, e, true); }
  }
  return true;
}

const selectedEdges = (bm) => BMO_slot_buffer_from_hflag(bm, 'e', BM_ELEM_SELECT).e;

// mesh.dissolve_verts, mesh.dissolve_edges and mesh.edge_collapse.
export const edbm_dissolve_verts_exec = (bm, props = {}) => bm.totvertsel && bmo_call(bm, bmo_dissolve_verts_exec, selectedVerts(bm), props);
export function edbm_dissolve_edges_exec(bm, props = {}) {
  if (!bm.totedgesel) return undefined;
  const before = [bm.totvert, bm.totedge, bm.totface];
  bmo_call(bm, bmo_dissolve_edges_exec, selectedEdges(bm), { use_verts: true, use_preserve_quads: true, ...props });
  return before.join() === [bm.totvert, bm.totedge, bm.totface].join() ? 'No edges dissolved' : undefined;
}
export const edbm_collapse_edge_exec = (bm) => bm.totedgesel && bmo_call(bm, bmo_collapse_exec, { edges: selectedEdges(bm) });

// mesh.dissolve_mode (Ctrl X): dissolves by the select mode, using verts unless in face mode.
export function edbm_dissolve_mode_exec(bm, props = {}) {
  if (bm.selectmode & SCE_SELECT_VERTEX) return edbm_dissolve_verts_exec(bm, props);
  if (bm.selectmode & SCE_SELECT_EDGE) return edbm_dissolve_edges_exec(bm, { use_verts: true, ...props });
  return edbm_dissolve_faces_exec(bm, props);
}

// Edit Mode operators by Blender idname, as (bm, props) for fixtures and keymaps.
export const meshOperators = {
  'mesh.delete': (bm, props) => edbm_delete_exec(bm, props.type),
  'mesh.extrude_region': (bm, props) => edbm_extrude_mesh(bm, props),
  'mesh.loopcut': (bm, props) => edbm_loopcut(bm, BM_edge_at_index(bm, props.edge_index), props),
  'transform.edge_slide': (bm, props) => edge_slide_exec(bm, props),
  'mesh.loop_select': (bm, props) => edbm_select_loop(bm, BM_edge_at_index(bm, props.edge_index), props),
  'mesh.inset': (bm, props) => edbm_inset_exec(bm, props),
  'mesh.bevel': (bm, props) => edbm_bevel_exec(bm, props),
  'mesh.quads_convert_to_tris': blenderOperator('mesh.quads_convert_to_tris'),
  'mesh.tris_convert_to_quads': blenderOperator('mesh.tris_convert_to_quads'),
  'mesh.flip_normals': blenderOperator('mesh.flip_normals'),
  'mesh.normals_make_consistent': blenderOperator('mesh.normals_make_consistent'),
  'mesh.vertices_smooth': blenderOperator('mesh.vertices_smooth'),
  'mesh.poke': blenderOperator('mesh.poke'),
  'mesh.subdivide': (bm, props) => edbm_subdivide_exec(bm, props),
  'mesh.dissolve_faces': (bm) => edbm_dissolve_faces_exec(bm),
  'mesh.dissolve_verts': (bm, props) => { edbm_dissolve_verts_exec(bm, props); },
  'mesh.dissolve_edges': (bm, props) => edbm_dissolve_edges_exec(bm, props),
  'mesh.dissolve_mode': (bm, props) => edbm_dissolve_mode_exec(bm, props) || undefined,
  'mesh.edge_collapse': (bm) => { edbm_collapse_edge_exec(bm); },
  'mesh.hide': (bm, props) => EDBM_mesh_hide(bm, bm.selectmode, !!props.unselected),
  'mesh.reveal': (bm) => EDBM_mesh_reveal(bm, bm.selectmode),
  'mesh.select_more': (bm, props) => EDBM_select_more(bm, bm.selectmode, props.use_face_step ?? true),
  'mesh.select_less': (bm, props) => EDBM_select_less(bm, bm.selectmode, props.use_face_step ?? true),
  'mesh.select_linked': (bm, props) => edbm_select_linked_exec(bm, props),
  'mesh.merge': (bm, props) => edbm_merge_exec(bm, props),
  'mesh.edge_face_add': (bm) => edbm_add_edge_face_exec(bm),
  'mesh.remove_doubles': (bm, props) => { const removed = edbm_remove_doubles_exec(bm, props); return `Removed ${removed} ${removed === 1 ? 'vertex' : 'vertices'}`; },
};
