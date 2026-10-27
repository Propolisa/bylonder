import { POOL } from '../../bmesh/intern/bmesh-marking.js';
import { BM_edge_at_index } from '../../bmesh/intern/bmesh-mesh.js';
import { BM_mesh_bm_from_me, BM_mesh_bm_to_me } from '../../bmesh/intern/bmesh-mesh-convert.js';
import { editMeshFromMesh, editMeshFree, editMeshSync, meshFromEditMesh, objectMatrixSet, runOperator, selectHistory, selectHistorySet, selectModeSet } from '../../bmesh/bmesh-wasm.js';
import { edbm_loopcut } from './editmesh-loopcut.js';
import { edbm_select_loop } from './editmesh-select.js';
import { EDBM_mesh_hide, EDBM_mesh_reveal } from './editmesh-utils.js';
import { edge_slide_exec } from '../transform/transform-mesh-edge-slide.js';

// The BMesh Blender's operators run on (src/bmesh/bmesh-wasm.js) is kept with the edit mesh between operators, as
// Blender keeps its own: a chain of operators then visits elements in Blender's order. What JS changed in between
// (selection, hiding, a move) is written into it; a change of topology by an operator still in JS rebuilds it.
const BLENDER_EDIT_MESH = Symbol('Blender edit mesh');
const freeing = new FinalizationRegistry(editMeshFree);
const sameTopology = (a, b) => ['edges', 'face_offsets', 'corner_verts', 'corner_edges']
  .every((key) => a[key].length === b[key].length && a[key].every((value, i) => value === b[key][i]));

function blenderEditMesh(bm) {
  const mesh = BM_mesh_bm_to_me(bm), kept = bm[BLENDER_EDIT_MESH];
  if (kept && sameTopology(kept.mesh, mesh)) {
    editMeshSync(kept.handle, mesh);
    selectModeSet(kept.handle, bm.selectmode);
    return kept.handle;
  }
  if (kept) {
    freeing.unregister(bm);
    editMeshFree(kept.handle);
  }
  return editMeshFromMesh(mesh, bm.selectmode);
}

// Runs Blender's own operator on the edit mesh and takes its result back; returns its report, if it made one.
// `object_to_world` (column-major, Blender's axes) places the object for what operators do in world space.
function blenderOperator(idname) {
  return (bm, props, { object_to_world } = {}) => {
    const handle = blenderEditMesh(bm), { selectmode } = bm;
    selectHistorySet(handle, (bm.selected ?? []).map(({ htype, ele }) => ({ htype, ele: bm[POOL[htype]].index[ele] })));
    if (object_to_world) objectMatrixSet(handle, object_to_world);
    const { report } = runOperator(handle, idname, props);
    const mesh = meshFromEditMesh(handle);
    Object.defineProperties(bm, Object.getOwnPropertyDescriptors(BM_mesh_bm_from_me(mesh)));
    bm.selectmode = selectmode;
    bm.selected = selectHistory(handle);
    bm[BLENDER_EDIT_MESH] = { handle, mesh };
    freeing.register(bm, handle, bm);
    return report;
  };
}

// Blender's operators run by their own code, which every fixture of theirs matches (tests/editmesh-wasm.test.js).
const BLENDER_OPERATORS = [
  'mesh.bevel',
  'mesh.delete',
  'mesh.dissolve_edges',
  'mesh.dissolve_faces',
  'mesh.dissolve_mode',
  'mesh.dissolve_verts',
  'mesh.edge_collapse',
  'mesh.edge_face_add',
  'mesh.extrude_region',
  'mesh.flip_normals',
  'mesh.inset',
  'mesh.merge',
  'mesh.normals_make_consistent',
  'mesh.poke',
  'mesh.quads_convert_to_tris',
  'mesh.remove_doubles',
  'mesh.select_less',
  'mesh.select_linked',
  'mesh.select_more',
  'mesh.subdivide',
  'mesh.tris_convert_to_quads',
  'mesh.vertices_smooth',
];

// Edit Mode operators by Blender idname, as (bm, props, context) for fixtures and keymaps.
export const meshOperators = {
  ...Object.fromEntries(BLENDER_OPERATORS.map((idname) => [idname, blenderOperator(idname)])),
  'mesh.loopcut': (bm, props) => edbm_loopcut(bm, BM_edge_at_index(bm, props.edge_index), props),
  'transform.edge_slide': (bm, props) => edge_slide_exec(bm, props),
  'mesh.loop_select': (bm, props) => edbm_select_loop(bm, BM_edge_at_index(bm, props.edge_index), props),
  'mesh.hide': (bm, props) => EDBM_mesh_hide(bm, bm.selectmode, !!props.unselected),
  'mesh.reveal': (bm) => EDBM_mesh_reveal(bm, bm.selectmode),
};
