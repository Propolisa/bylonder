// Loop Cut (editmesh_loopcut.cc).
import { BM_ELEM_SELECT, BM_VERT, BM_EDGE, BM_FACE } from '../../bmesh/intern/bmesh-class.js';
import { BMW_edgering } from '../../bmesh/intern/bmesh-walkers.js';
import { BM_edge_is_wire, BM_edge_is_any_face_len_test } from '../../bmesh/intern/bmesh-query.js';
import { BM_edge_select_set, BM_vert_select_set, BM_mesh_elem_hflag_disable_all, BM_mesh_select_mode_flush_ex, SCE_SELECT_VERTEX, SCE_SELECT_EDGE, SCE_SELECT_FACE } from '../../bmesh/intern/bmesh-marking.js';
import { EDBM_edge_find_nearest, SELECT_DIST_PX } from './editmesh-select.js';
import { EDBM_preselect_edgering_update_from_edge, createPreselectEdgering } from './editmesh-preselect-edgering.js';
import { BM_mesh_esubdivide, SUBD_CORNER_PATH, SUBDIV_SELECT_INNER, SUBDIV_SELECT_NONE, SUBDIV_SELECT_LOOPCUT } from '../../bmesh/operators/bmo-subdivide.js';


// ringsel_finish with do_cut: selects the ring through `eed` and cuts it. Returns the select mode afterwards
// (face select mode switches to edge select mode, for the edge slide that follows).
export function edbm_loopcut(bm, eed, { number_cuts = 1, smoothness = 0 } = {}) {
  const v_eed_orig = [bm.e.v1[eed], bm.e.v2[eed]];
  BM_mesh_elem_hflag_disable_all(bm, BM_VERT | BM_EDGE | BM_FACE, BM_ELEM_SELECT);
  for (const e of BMW_edgering(bm, eed)) BM_edge_select_set(bm, e, true);
  const is_edge_wire = BM_edge_is_wire(bm, eed);
  const is_single = is_edge_wire || !BM_edge_is_any_face_len_test(bm, eed, 4);
  const seltype = is_edge_wire ? SUBDIV_SELECT_INNER : is_single ? SUBDIV_SELECT_NONE : SUBDIV_SELECT_LOOPCUT;
  BM_mesh_esubdivide(bm, { seltype, cuts: number_cuts, smooth: smoothness, quad_corner_type: SUBD_CORNER_PATH, use_grid_fill: true });
  if (is_single) {
    BM_vert_select_set(bm, v_eed_orig[0], false);
    BM_vert_select_set(bm, v_eed_orig[1], false);
    BM_mesh_select_mode_flush_ex(bm, SCE_SELECT_VERTEX);
  } else if (bm.selectmode === SCE_SELECT_FACE) bm.selectmode = SCE_SELECT_EDGE;
  else BM_mesh_select_mode_flush_ex(bm, bm.selectmode);
  return bm.selectmode;
}

const SUBD_CUTS_MAX = 500;

// The modal part of mesh.loopcut: the ring under the mouse previews its cuts; the wheel or Page Up and Page Down
// change the number of cuts. `confirm(edge, cuts)` runs the cut.
export function loopcut_modal({ bm, owner, notify, confirm }) {
  const preview = createPreselectEdgering(owner);
  let eed = -1, cuts = 1;
  const status = () => notify(`Cuts: ${cuts}, Smoothness: 0.00`);
  const refresh = () => preview.update(eed >= 0 ? EDBM_preselect_edgering_update_from_edge(bm(), eed, cuts) : null);
  const setCuts = (n) => { cuts = Math.max(1, Math.min(SUBD_CUTS_MAX, n)); refresh(); status(); };
  status();
  return {
    // `view` as editmesh-select needs it.
    move(view, mouse) {
      const e = EDBM_edge_find_nearest(bm(), view, mouse, SELECT_DIST_PX, false);
      if (e !== eed) { eed = e; refresh(); }
    },
    wheel(up) { setCuts(cuts + (up ? 1 : -1)); },
    key(e) {
      if (e.key === 'PageUp' || e.key === 'PageDown') { setCuts(cuts + (e.key === 'PageUp' ? 1 : -1)); return 'running'; }
      if (e.key === 'Enter') return this.finish();
      if (e.key === 'Escape') return 'cancelled';
      return null;
    },
    finish() {
      if (eed < 0) return 'cancelled';
      confirm(eed, cuts);
      return 'finished';
    },
    dispose: () => preview.dispose(),
  };
}
