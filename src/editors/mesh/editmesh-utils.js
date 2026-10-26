// Edit Mode helpers (editmesh_utils.cc).
import { BM_ITER_MESH, BM_VERT, BM_EDGE, BM_FACE, BM_ELEM_SELECT, BM_ELEM_HIDDEN, BM_ELEM_TAG, BM_elem_flag_test, BM_elem_flag_enable, BM_elem_flag_disable } from '../../bmesh/intern/bmesh-class.js';
import { SCE_SELECT_VERTEX, SCE_SELECT_EDGE, SCE_SELECT_FACE, BM_elem_hide_set, BM_elem_select_set, BM_mesh_select_mode_flush_ex, BM_mesh_elem_hflag_disable_all } from '../../bmesh/intern/bmesh-marking.js';
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
