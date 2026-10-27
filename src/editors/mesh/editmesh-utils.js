// Edit Mode helpers (editmesh_utils.cc).
import { BM_ITER_MESH, BM_VERT, BM_EDGE, BM_FACE, BM_ELEM_SELECT, BM_ELEM_HIDDEN, BM_ELEM_TAG, BM_elem_flag_test, BM_elem_flag_enable, BM_elem_flag_disable } from '../../bmesh/intern/bmesh-class.js';
import { SCE_SELECT_VERTEX, SCE_SELECT_EDGE, SCE_SELECT_FACE, BM_elem_hide_set, BM_elem_select_set, BM_mesh_select_mode_flush_ex, BM_mesh_elem_hflag_disable_all, BM_vert_select_set, BM_edge_select_set, BM_edge_select_set_noflush, BM_face_select_set, BM_face_select_set_noflush, BM_mesh_select_mode_clean_ex } from '../../bmesh/intern/bmesh-marking.js';
import { bmo_call, BMO_op_vinitf, BMO_op_exec, BMO_op_finish, BMO_slot_get, BMO_slot_buffer_hflag_enable, BMO_error_pop, BMO_FLAG_DEFAULTS, BMO_ERROR_CANCEL } from '../../bmesh/intern/bmesh-operators.js';
import { bmo_region_extend_exec } from '../../bmesh/operators/bmo-utils.js';
import { BM_edge_is_wire } from '../../bmesh/intern/bmesh-query.js';

const TYPES = [['v', BM_VERT], ['e', BM_EDGE], ['f', BM_FACE]];

// mesh.hide: hides the selected elements of the lowest enabled select mode, or with `swap` the unselected ones.
export function EDBM_mesh_hide(bm, selectmode, swap) {
  const [pool, htype] = selectmode & SCE_SELECT_VERTEX ? TYPES[0] : selectmode & SCE_SELECT_EDGE ? TYPES[1] : TYPES[2];
  let changed = false;
  BM_ITER_MESH(bm[pool], (i) => {
    if (!BM_elem_flag_test(bm[pool], i, BM_ELEM_HIDDEN) && BM_elem_flag_test(bm[pool], i, BM_ELEM_SELECT) !== swap) {
      BM_elem_hide_set(bm, htype, i, true);
      changed = true;
    }
  });
  if (swap) {
    const loose = (name, test) => BM_ITER_MESH(bm[name], (i) => {
      if (test(i) && !BM_elem_flag_test(bm[name], i, BM_ELEM_HIDDEN) && !BM_elem_flag_test(bm[name], i, BM_ELEM_SELECT)) {
        BM_elem_hide_set(bm, name === 'e' ? BM_EDGE : BM_VERT, i, true);
        changed = true;
      }
    });
    if (htype === BM_FACE) loose('e', (e) => BM_edge_is_wire(bm, e));
    if (htype !== BM_VERT) loose('v', (v) => bm.v.e[v] < 0);
  }
  if (changed) BM_mesh_select_mode_flush_ex(bm, selectmode);
  return changed;
}

// mesh.reveal: shows everything hidden and, with `select`, selects what was revealed in the enabled modes.
export function EDBM_mesh_reveal(bm, selectmode, select = true) {
  let changed = false;
  for (const [pool] of TYPES) BM_ITER_MESH(bm[pool], (i) => {
    const hidden = BM_elem_flag_test(bm[pool], i, BM_ELEM_HIDDEN);
    (hidden ? BM_elem_flag_enable : BM_elem_flag_disable)(bm[pool], i, BM_ELEM_TAG);
    changed ||= hidden;
  });
  if (!changed) return false;
  BM_mesh_elem_hflag_disable_all(bm, BM_VERT | BM_EDGE | BM_FACE, BM_ELEM_HIDDEN);
  const modes = [SCE_SELECT_VERTEX, SCE_SELECT_EDGE, SCE_SELECT_FACE];
  TYPES.forEach(([pool, htype], i) => {
    if (!(selectmode & modes[i])) return;
    BM_ITER_MESH(bm[pool], (ele) => { if (BM_elem_flag_test(bm[pool], ele, BM_ELEM_TAG)) BM_elem_select_set(bm, htype, ele, select); });
  });
  BM_mesh_select_mode_flush_ex(bm, selectmode);
  return true;
}

// EDBM_select_more and EDBM_select_less: grow or shrink the selection by one step of edges, or of faces with
// `use_face_step`. Only face mode flushes the change.
function select_region_extend(bm, selectmode, use_face_step, use_contract) {
  const use_faces = selectmode === SCE_SELECT_FACE;
  const geom = Object.fromEntries([['verts', 'v'], ['edges', 'e'], ['faces', 'f']].map(([slot, pool]) => [slot, selectedOf(bm, pool)]));
  const out = bmo_call(bm, bmo_region_extend_exec, { geom, use_contract, use_faces, use_face_step });
  const select = !use_contract;
  for (const v of out.verts) BM_vert_select_set(bm, v, select);
  for (const e of out.edges) (use_faces ? BM_edge_select_set : BM_edge_select_set_noflush)(bm, e, select);
  for (const f of out.faces) (use_faces ? BM_face_select_set : BM_face_select_set_noflush)(bm, f, select);
  BM_mesh_select_mode_flush_ex(bm, selectmode);
  if (use_contract) BM_mesh_select_mode_clean_ex(bm, selectmode);
}
const selectedOf = (bm, pool) => { const out = []; BM_ITER_MESH(bm[pool], (i) => { if (BM_elem_flag_test(bm[pool], i, BM_ELEM_SELECT)) out.push(i); }); return out; };
export const EDBM_select_more = (bm, selectmode, use_face_step = true) => select_region_extend(bm, selectmode, use_face_step, false);
export const EDBM_select_less = (bm, selectmode, use_face_step = true) => select_region_extend(bm, selectmode, use_face_step, true);

// EDBM_op_init, EDBM_op_finish, EDBM_op_callf and EDBM_op_call_and_selectf (editmesh_utils.cc), on the BMesh itself.
export const EDBM_op_init = (bm, bmop, fmt, ...args) => BMO_op_vinitf(bm, bmop, BMO_FLAG_DEFAULTS, fmt, args);

// Whether the operator changed the mesh: false when it cancelled with an error.
export function EDBM_op_finish(bm, bmop) {
  BMO_op_finish(bm, bmop);
  let changed = true, error;
  while ((error = BMO_error_pop(bm))) if (error.level === BMO_ERROR_CANCEL) changed = false;
  return changed;
}

export function EDBM_op_callf(bm, fmt, ...args) {
  const bmop = {};
  if (!BMO_op_vinitf(bm, bmop, BMO_FLAG_DEFAULTS, fmt, args)) return false;
  BMO_op_exec(bm, bmop);
  return EDBM_op_finish(bm, bmop);
}

export function EDBM_op_call_and_selectf(bm, select_slot_out, select_extend, fmt, ...args) {
  const bmop = {};
  if (!BMO_op_vinitf(bm, bmop, BMO_FLAG_DEFAULTS, fmt, args)) return false;
  BMO_op_exec(bm, bmop);
  const hflag = BMO_slot_get(bmop.slots_out, select_slot_out).slot_subtype.elem & (BM_VERT | BM_EDGE | BM_FACE);
  if (!select_extend) BM_mesh_elem_hflag_disable_all(bm, BM_VERT | BM_EDGE | BM_FACE, BM_ELEM_SELECT);
  BMO_slot_buffer_hflag_enable(bm, bmop.slots_out, select_slot_out, hflag, BM_ELEM_SELECT, true);
  return EDBM_op_finish(bm, bmop);
}
