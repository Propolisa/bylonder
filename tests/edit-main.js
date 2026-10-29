// A mesh object in Edit Mode in a Main of its own, for tests of Blender's Edit Mode operators: made from a Mesh,
// selected as Blender's fixture scripts select with bmesh (bmesh-api.cc on edit-api.cc's BMesh), run and invoked on
// Main's context, read as the draw cache extracts the edit mesh.
import { BlenderMain, moduleAccess, EXTRACT_ALL } from '../src/bmesh/bmesh-wasm.js';

const { x, withArrays, ownedMesh } = moduleAccess;
const SELECT_MODES = { 1: 'VERT', 2: 'EDGE', 4: 'FACE' };
let shared;
// The Main, made the one operator properties are set in.
const current = () => { shared ??= new BlenderMain(); x.rna_context_set(shared.C); return shared; };

export function editOnMain(mesh, selectmode = 1, transform = {}) {
  const main = current(), ob = main.add('MESH', 'Edit');
  main.setMesh(ob, mesh);
  main.setTransform(ob, transform);
  main.evaluate();
  main.setBase(ob, { select: true, active: true });
  main.run('object.mode_set', { mode: 'EDIT' });
  const bm = () => x.object_edit_bmesh(ob);
  const edit = {
    main,
    ob,
    set view(view) { main.view = view; },
    get status() { return main.status; },
    run: (idname, props) => current().run(idname, props),
    invoke: (idname, props, event) => current().invoke(idname, props, event),
    modal: (op, event) => current().modal(op, event),
    modalItem: (op, identifier) => main.modalItem(op, identifier),
    // Clears the selection and its history and sets the select mode.
    selectClear(mode) {
      current().run('mesh.select_mode', { type: SELECT_MODES[mode] });
      x.bm_select_clear(bm(), mode);
    },
    // Selects an element and records it in the selection history.
    select: (htype, index) => x.bm_select(bm(), htype, index),
    selectElements: (htype, indices, selects) => withArrays([Int32Array.from(indices), Uint8Array.from(selects, Boolean)],
      ([i, s]) => x.bm_select_elements(bm(), htype, i, s, indices.length)),
    selectFlush: () => x.object_edit_select_flush(ob),
    extract: (what = EXTRACT_ALL) => main.editMesh(ob, what).mesh,
    toMesh: () => ownedMesh(main.editMesh(ob).mesh),
    free() {
      current().run('object.mode_set', { mode: 'OBJECT' });
      main.remove(ob);
    },
  };
  edit.selectClear(selectmode);
  return edit;
}
