// Edit Mode operators by Blender idname on the edit mesh (an EditMesh, src/bmesh/bmesh-wasm.js): Blender's own, run by
// their exec in WebAssembly, and the two still ported to JS.
import { POOL } from '../../bmesh/intern/bmesh-marking.js';
import { BM_edge_at_index } from '../../bmesh/intern/bmesh-mesh.js';
import { BM_mesh_bm_from_me, BM_mesh_bm_to_me } from '../../bmesh/intern/bmesh-mesh-convert.js';
import { hasOperator } from '../../bmesh/bmesh-wasm.js';
import { edbm_loopcut } from './editmesh-loopcut.js';
import { edge_slide_exec } from '../transform/transform-mesh-edge-slide.js';

// Loop Cut and Edge Slide run as JS ports until Blender's run in WebAssembly (Loop Cut reads the evaluated mesh
// through the depsgraph; Edge Slide is part of Blender's transform system). They work on a BMesh of the edit mesh's
// Mesh arrays, whose elements are in the same order, for as long as they run.
export function editBMesh(edit, mesh = edit.toMesh()) {
  const bm = BM_mesh_bm_from_me(mesh);
  bm.selectmode = edit.selectmode;
  bm.selected = edit.history.map(({ htype, index }) => ({ htype, ele: index }));
  return bm;
}

// Makes a JS BMesh's result the edit mesh.
function applyBMesh(edit, bm) {
  edit.replace(BM_mesh_bm_to_me(bm));
  edit.history = (bm.selected ?? []).map(({ htype, ele }) => ({ htype, index: bm[POOL[htype]].index[ele] }));
}

const PORTED = {
  'mesh.loopcut': (bm, props) => edbm_loopcut(bm, BM_edge_at_index(bm, props.edge_index), props),
  'transform.edge_slide': edge_slide_exec,
};

export const hasMeshOperator = (idname) => idname in PORTED || hasOperator(idname);

// Runs an Edit Mode operator; returns its report, if it made one.
export function meshOperator(edit, idname, props = {}) {
  if (!PORTED[idname]) return edit.run(idname, props).report;
  const bm = editBMesh(edit);
  PORTED[idname](bm, props);
  applyBMesh(edit, bm);
  return undefined;
}

// Previews an operator, leaving the edit mesh untouched: each run starts from a copy of it and gives the result's Mesh
// and active element ({ htype, index }).
export function operatorPreview(edit, idname) {
  return (props) => {
    const copy = edit.copy();
    try {
      meshOperator(copy, idname, props);
      return { mesh: copy.toMesh(), active: copy.history.at(-1) };
    } finally {
      copy.free();
    }
  };
}
