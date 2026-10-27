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

// Blender's operators the module registers but does not run yet, by what they reach that it lacks; menus leave them
// out (tests/editmesh-menus.test.js checks the rest run).
const lacking = (reason, idnames) => idnames.map((idname) => [idname, reason]);
const NOT_YET = Object.fromEntries([
  ...lacking("Blender's object data functions", [
    'mesh.uv_texture_add', 'mesh.uv_texture_remove', 'mesh.customdata_mask_clear', 'mesh.customdata_face_sets_clear',
    'mesh.customdata_skin_add', 'mesh.customdata_skin_clear', 'mesh.customdata_custom_splitnormals_add',
    'mesh.customdata_custom_splitnormals_clear', 'mesh.reorder_vertices_spatial', 'mesh.colors_rotate', 'mesh.colors_reverse',
    'mesh.attribute_set', 'mesh.separate', 'mesh.sort_elements', 'mesh.circularize', 'mesh.shape_propagate_to_all',
  ]),
  ...lacking("Blender's gizmos", ['mesh.bisect', 'mesh.spin']),
  ...lacking("Blender's live UV unwrap", ['mesh.mark_seam']),
  ...lacking('Bullet, which the module is built without', ['mesh.convex_hull']),
  ...lacking("the 3D View's interactive tools", [
    'mesh.knife_tool', 'mesh.knife_project', 'mesh.rip', 'mesh.rip_edge', 'mesh.dupli_extrude_cursor', 'mesh.polybuild_face_at_cursor',
    'mesh.polybuild_split_at_cursor', 'mesh.polybuild_dissolve_at_cursor', 'mesh.polybuild_transform_at_cursor',
    'mesh.polybuild_delete_at_cursor',
  ]),
]);
export const runsMeshOperator = (idname) => hasMeshOperator(idname) && !NOT_YET[idname];

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
