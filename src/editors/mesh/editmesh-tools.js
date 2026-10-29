// Edit Mode operators by Blender idname on the edit mesh (an EditMesh, src/bmesh/bmesh-wasm.js): Blender's own, run by
// their exec in WebAssembly.
import { BM_mesh_bm_from_me } from '../../bmesh/intern/bmesh-mesh-convert.js';
import { hasOperator } from '../../bmesh/bmesh-wasm.js';

// Ctrl R's Loop Cut preview and G G's Edge Slide in Bylonder's Move still run as JS ports, on a BMesh of the edit
// mesh's Mesh arrays, whose elements are in the same order, for as long as they run.
export function editBMesh(edit, mesh = edit.toMesh()) {
  const bm = BM_mesh_bm_from_me(mesh);
  bm.selectmode = edit.selectmode;
  bm.selected = edit.history.map(({ htype, index }) => ({ htype, ele: index }));
  return bm;
}

export const hasMeshOperator = hasOperator;

// Blender's operators the module registers but does not run yet, by what they reach that it lacks; menus leave them
// out (tests/editmesh-menus.test.js checks the rest run).
const lacking = (reason, idnames) => idnames.map((idname) => [idname, reason]);
const NOT_YET = Object.fromEntries([
  ...lacking('new objects, which need a Main the module does not have', ['mesh.separate']),
  ...lacking("Blender's attribute RNA", ['mesh.attribute_set']),
  ...lacking("Blender's shape key checks", ['mesh.shape_propagate_to_all']),
  ...lacking("Blender's live UV unwrap", ['mesh.mark_seam']),
  ...lacking("other objects' meshes, which need a Main the module does not have", ['mesh.knife_project']),
]);
export const runsMeshOperator = (idname) => hasMeshOperator(idname) && !NOT_YET[idname];

// Runs an Edit Mode operator; returns its report, if it made one.
export const meshOperator = (edit, idname, props = {}) => edit.run(idname, props).report;

// Previews an operator, leaving the edit mesh untouched: each run starts from a copy of it and gives what `use` makes of
// the result while it exists, by default its Mesh and active element ({ htype, index }).
export function operatorPreview(edit, idname) {
  return (props, use = (copy) => ({ mesh: copy.toMesh(), active: copy.history.at(-1) })) => {
    const copy = edit.copy();
    try {
      meshOperator(copy, idname, props);
      return use(copy);
    } finally {
      copy.free();
    }
  };
}
