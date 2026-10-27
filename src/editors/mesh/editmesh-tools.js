// Edit Mode operators by Blender idname on the edit mesh (an EditMesh, src/bmesh/bmesh-wasm.js): Blender's own, run by
// their exec in WebAssembly.
import { BM_mesh_bm_from_me } from '../../bmesh/intern/bmesh-mesh-convert.js';
import { hasOperator } from '../../bmesh/bmesh-wasm.js';

// The interactive Edge Slide and Loop Cut previews still run as JS ports, on a BMesh of the edit mesh's Mesh arrays,
// whose elements are in the same order, for as long as they run.
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
  ...lacking("Blender's gizmos", ['mesh.bisect', 'mesh.spin']),
  ...lacking("Blender's live UV unwrap", ['mesh.mark_seam']),
  ...lacking("the 3D View's interactive tools", [
    'mesh.knife_tool', 'mesh.knife_project', 'mesh.rip', 'mesh.rip_edge', 'mesh.dupli_extrude_cursor', 'mesh.polybuild_face_at_cursor',
    'mesh.polybuild_split_at_cursor', 'mesh.polybuild_dissolve_at_cursor', 'mesh.polybuild_transform_at_cursor',
    'mesh.polybuild_delete_at_cursor',
  ]),
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
