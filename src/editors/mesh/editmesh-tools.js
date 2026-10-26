// Edit Mode mesh operators (editmesh_tools.cc).
import { BM_ITER_MESH, BM_ELEM_SELECT, BM_VERT, BM_EDGE, BM_FACE, BM_elem_flag_test } from '../../bmesh/intern/bmesh-class.js';
import { BMO_op_callf } from '../../bmesh/intern/bmesh-operators.js';
import { BM_mesh_elem_hflag_disable_all } from '../../bmesh/intern/bmesh-marking.js';
import { DEL_VERTS, DEL_EDGES, DEL_FACES, DEL_EDGESFACES, DEL_ONLYFACES } from '../../bmesh/intern/bmesh-delete.js';
import { bmo_delete_exec } from '../../bmesh/operators/bmo-dupe.js';
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

// Edit Mode operators by Blender idname, as (bm, props) for fixtures and keymaps.
export const meshOperators = {
  'mesh.delete': (bm, props) => edbm_delete_exec(bm, props.type),
  'mesh.hide': (bm, props) => EDBM_mesh_hide(bm, bm.selectmode, !!props.unselected),
  'mesh.reveal': (bm) => EDBM_mesh_reveal(bm, bm.selectmode),
};
