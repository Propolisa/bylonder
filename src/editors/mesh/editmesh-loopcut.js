// Loop Cut (editmesh_loopcut.cc).
import { EDBM_edge_find_nearest, SELECT_DIST_PX } from './editmesh-select.js';
import { createKeymap } from '../../windowmanager/input/keymap.js';
import { EDBM_preselect_edgering_update_from_edge, createPreselectEdgering } from './editmesh-preselect-edgering.js';

const SUBD_CUTS_MAX = 500;

// The modal part of mesh.loopcut as a modal handler: the ring under the mouse previews its cuts; the wheel or Page
// Up and Page Down change the number of cuts. Blender hard-codes these keys in loopcut_modal, so they have no modal
// keymap names. `mesh` is the edit mesh's Mesh arrays and `bm` a BMesh of them, with elements in the same order;
// `confirm(edge, cuts)` runs the cut; `adapter(view)` gives the view as editmesh-select needs it; `end()` removes the
// handler.
export function loopcut_modal({ mesh, bm, owner, adapter, notify, confirm, end }) {
  const preview = createPreselectEdgering(owner);
  let eed = -1, cuts = 1;
  const status = () => notify(`Cuts: ${cuts}, Smoothness: 0.00`);
  const refresh = () => preview.update(eed >= 0 ? EDBM_preselect_edgering_update_from_edge(bm, eed, cuts) : null);
  const setCuts = (n) => { cuts = Math.max(1, Math.min(SUBD_CUTS_MAX, n)); refresh(); status(); };
  const finish = (ok) => { preview.dispose(); notify(''); end(); if (ok && eed >= 0) confirm(eed, cuts); };
  status();
  return {
    mousemove(event) {
      if (!event.view) return;
      const e = EDBM_edge_find_nearest(mesh, adapter(event.view), [event.x, event.y], SELECT_DIST_PX, false);
      if (e !== eed) { eed = e; refresh(); }
    },
    keymap: createKeymap([
      { keys: ['LEFTMOUSE', 'RET', 'NUMPAD_ENTER'], run: () => finish(true) },
      { keys: ['RIGHTMOUSE', 'ESC'], run: () => finish(false) },
      { keys: ['WHEELUPMOUSE', 'PAGE_UP'], run: () => setCuts(cuts + 1) },
      { keys: ['WHEELDOWNMOUSE', 'PAGE_DOWN'], run: () => setCuts(cuts - 1) },
    ]),
    // Navigation keys pass through to the view.
    passthrough: (event) => event.type === 'middlemouse',
    cancel: () => finish(false),
  };
}
