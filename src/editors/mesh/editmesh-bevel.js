// mesh.bevel (editmesh_bevel.cc) over Blender's generated bevel tool, with bmo_bevel_exec's tagging.
import { BM_ITER_MESH, BM_ELEM_SELECT, BM_ELEM_TAG, BM_VERT, BM_EDGE, BM_FACE, BM_elem_flag_test, BM_elem_flag_enable } from '../../bmesh/intern/bmesh-class.js';
import { BM_mesh_elem_hflag_disable_all, BM_face_select_set, BM_vert_select_set, BM_mesh_select_mode_flush } from '../../bmesh/intern/bmesh-marking.js';
import { BM_edge_is_manifold } from '../../bmesh/intern/bmesh-query.js';
import { BM_mesh_bevel } from '../../bmesh/tools/bmesh-bevel.js';
import { CustomData_get_offset_named } from '../../blenkernel/customdata.js';
import { CD_PROP_FLOAT } from '../../makesdna/customdata-types.js';

const OFFSET_TYPE = { OFFSET: 0, WIDTH: 1, DEPTH: 2, PERCENT: 3, ABSOLUTE: 4 };
const PROFILE_TYPE = { SUPERELLIPSE: 0, CUSTOM: 1 };
const AFFECT = { VERTICES: 0, EDGES: 1 };
const MITER = { SHARP: 0, PATCH: 1, ARC: 2 };
const VMESH = { ADJ: 0, CUTOFF: 1 };
const FACE_STRENGTH = { NONE: 0, NEW: 1, AFFECTED: 2, ALL: 3 };

export function edbm_bevel_exec(bm, {
  offset_type = 'OFFSET', offset = 0, profile_type = 'SUPERELLIPSE', segments = 1, profile = 0.5, affect = 'EDGES',
  clamp_overlap = false, loop_slide = true, mark_seam = false, mark_sharp = false, material = -1, harden_normals = false,
  face_strength_mode = 'NONE', miter_outer = 'SHARP', miter_inner = 'SHARP', spread = 0.1, vmesh_method = 'ADJ',
} = {}) {
  if (!(offset > 0)) return false;
  // bmo_bevel_exec: the selection is the operator's geom.
  const geom = { v: [], e: [] };
  BM_ITER_MESH(bm.v, (v) => BM_elem_flag_test(bm.v, v, BM_ELEM_SELECT) && geom.v.push(v));
  BM_ITER_MESH(bm.e, (e) => BM_elem_flag_test(bm.e, e, BM_ELEM_SELECT) && geom.e.push(e));
  BM_mesh_elem_hflag_disable_all(bm, BM_VERT | BM_EDGE | BM_FACE, BM_ELEM_TAG);
  for (const v of geom.v) BM_elem_flag_enable(bm.v, v, BM_ELEM_TAG);
  for (const e of geom.e) {
    if (!BM_edge_is_manifold(bm, e)) continue;
    BM_elem_flag_enable(bm.e, e, BM_ELEM_TAG);
    BM_elem_flag_enable(bm.v, bm.e.v1[e], BM_ELEM_TAG);
    BM_elem_flag_enable(bm.v, bm.e.v2[e], BM_ELEM_TAG);
  }
  BM_mesh_bevel(bm, offset, OFFSET_TYPE[offset_type], PROFILE_TYPE[profile_type], segments, profile, AFFECT[affect], false,
    clamp_overlap, null, -1, material, loop_slide, mark_seam, mark_sharp, harden_normals, FACE_STRENGTH[face_strength_mode],
    MITER[miter_outer], MITER[miter_inner], spread, null, VMESH[vmesh_method],
    CustomData_get_offset_named(bm.vdata, CD_PROP_FLOAT, 'bevel_weight_vert'), CustomData_get_offset_named(bm.edata, CD_PROP_FLOAT, 'bevel_weight_edge'));
  // edbm_bevel_calc: the new faces (and for a vertex bevel, the new verts) end up selected.
  BM_mesh_elem_hflag_disable_all(bm, BM_VERT | BM_EDGE | BM_FACE, BM_ELEM_SELECT);
  BM_ITER_MESH(bm.f, (f) => BM_elem_flag_test(bm.f, f, BM_ELEM_TAG) && BM_face_select_set(bm, f, true));
  if (affect === 'VERTICES') BM_ITER_MESH(bm.v, (v) => BM_elem_flag_test(bm.v, v, BM_ELEM_TAG) && BM_vert_select_set(bm, v, true));
  BM_mesh_select_mode_flush(bm);
  return true;
}
