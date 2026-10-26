// Edit Mode mesh operators (editmesh_tools.cc).
import { BM_ITER_MESH, BM_ELEM_SELECT, BM_VERT, BM_EDGE, BM_FACE, BM_elem_flag_test } from '../../bmesh/intern/bmesh-class.js';
import { bmo_extrude_face_region_exec, bmo_extrude_edge_only_exec, bmo_extrude_vert_indiv_exec } from '../../bmesh/operators/bmo-extrude.js';
import { BMO_op_callf } from '../../bmesh/intern/bmesh-operators.js';
import { DEL_VERTS, DEL_EDGES, DEL_FACES, DEL_EDGESFACES, DEL_ONLYFACES } from '../../bmesh/intern/bmesh-delete.js';
import { bmo_delete_exec } from '../../bmesh/operators/bmo-dupe.js';
import { bmo_dissolve_faces_exec } from '../../bmesh/operators/bmo-dissolve.js';
import { BM_mesh_elem_hflag_disable_all, BM_face_select_set, BM_vert_select_set, BM_elem_select_set, SCE_SELECT_VERTEX, SCE_SELECT_EDGE } from '../../bmesh/intern/bmesh-marking.js';
import { BM_mesh_esubdivide, SUBD_CORNER_INNERVERT, SUBD_CORNER_PATH, SUBD_CORNER_FAN, SUBD_CORNER_STRAIGHT_CUT, SUBDIV_SELECT_ORIG } from '../../bmesh/operators/bmo-subdivide.js';
import { edbm_loopcut } from './editmesh-loopcut.js';
import { edbm_select_loop } from './editmesh-select.js';
import { bmo_inset_region_exec } from '../../bmesh/operators/bmo-inset.js';
import { edge_slide_exec } from '../transform/transform-mesh-edge-slide.js';
import { BM_edge_at_index } from '../../bmesh/intern/bmesh-query.js';
import { EDBM_mesh_hide, EDBM_mesh_reveal } from './editmesh-utils.js';

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
  BMO_op_callf(bm, bmo_delete_exec, BMO_slot_buffer_from_hflag(bm, pool, BM_ELEM_SELECT), context);
  BM_mesh_elem_hflag_disable_all(bm, BM_VERT | BM_EDGE | BM_FACE, BM_ELEM_SELECT);
}

// mesh.dissolve_faces: the joined faces end up selected.
export function edbm_dissolve_faces_exec(bm) {
  const region = BMO_op_callf(bm, bmo_dissolve_faces_exec, BMO_slot_buffer_from_hflag(bm, 'f', BM_ELEM_SELECT).f);
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
  selectGeom(bm, BMO_op_callf(bm, bmo_extrude_face_region_exec, geom, { use_normal_flip, use_select_history: true }));
}

function edbm_extrude_edges_indiv(bm, { use_normal_flip = false } = {}) {
  const edges = BMO_slot_buffer_from_hflag(bm, 'e', BM_ELEM_SELECT).e;
  deselectKeepHistory(bm);
  const out = BMO_op_callf(bm, bmo_extrude_edge_only_exec, edges, { use_normal_flip, use_select_history: true });
  selectGeom(bm, { v: out.v, e: out.e });
}

function edbm_extrude_verts_indiv(bm) {
  const verts = BMO_slot_buffer_from_hflag(bm, 'v', BM_ELEM_SELECT).v;
  for (const v of verts) BM_vert_select_set(bm, v, false);
  BMO_op_callf(bm, bmo_extrude_vert_indiv_exec, verts, { use_select_history: true }).v.forEach((v) => BM_vert_select_set(bm, v, true));
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

// mesh.inset (Inset Faces; individual insets are not ported yet).
export function edbm_inset_exec(bm, { use_boundary = true, use_even_offset = true, use_relative_offset = false, use_edge_rail = false, thickness = 0, depth = 0, use_outset = false, use_select_inset = false } = {}) {
  const faces = BMO_slot_buffer_from_hflag(bm, 'f', BM_ELEM_SELECT).f;
  if (!faces.length) return false;
  const out = BMO_op_callf(bm, bmo_inset_region_exec, faces, { use_boundary, use_even_offset, use_relative_offset, use_edge_rail, thickness, depth, use_outset });
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

// Edit Mode operators by Blender idname, as (bm, props) for fixtures and keymaps.
export const meshOperators = {
  'mesh.delete': (bm, props) => edbm_delete_exec(bm, props.type),
  'mesh.extrude_region': (bm, props) => edbm_extrude_mesh(bm, props),
  'mesh.loopcut': (bm, props) => edbm_loopcut(bm, BM_edge_at_index(bm, props.edge_index), props),
  'transform.edge_slide': (bm, props) => edge_slide_exec(bm, props),
  'mesh.loop_select': (bm, props) => edbm_select_loop(bm, BM_edge_at_index(bm, props.edge_index), props),
  'mesh.inset': (bm, props) => edbm_inset_exec(bm, props),
  'mesh.subdivide': (bm, props) => edbm_subdivide_exec(bm, props),
  'mesh.dissolve_faces': (bm) => edbm_dissolve_faces_exec(bm),
  'mesh.hide': (bm, props) => EDBM_mesh_hide(bm, bm.selectmode, !!props.unselected),
  'mesh.reveal': (bm) => EDBM_mesh_reveal(bm, bm.selectmode),
};
