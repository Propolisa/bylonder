// Edit Mode in Blender's own code (tools/blender-port/wasm/bmesh-api.cc, built by wasm_module.py): the BMesh lives in
// the module, meshes go in and come out as Blender's edit mode orders them, and operators run as Blender's run them.
import { instantiate } from '../port/wasm.js';
import { operatorProperties } from '../editors/mesh/editmesh-add.js';

const { exports: x } = await instantiate(new URL('./bmesh.wasm', import.meta.url));

// Copies arrays into module memory, runs fn with their pointers, and frees them.
function withArrays(arrays, fn) {
  const pointers = arrays.map((a) => {
    const p = x.malloc(a.byteLength);
    new a.constructor(x.memory.buffer, p, a.length).set(a);
    return p;
  });
  try {
    return fn(pointers);
  } finally {
    pointers.forEach((p) => x.free(p));
  }
}

// The edit BMesh of a mesh (Mesh: verts_num, vert_positions, edges, face_offsets, corner_verts, corner_edges),
// in a select mode (SCE_SELECT_*). Free it with editMeshFree.
export function editMeshFromMesh(mesh, selectmode) {
  const { vert_positions, edges, face_offsets, corner_verts, corner_edges } = mesh;
  return withArrays([Float32Array.from(vert_positions), Int32Array.from(edges), Int32Array.from(face_offsets), Int32Array.from(corner_verts), Int32Array.from(corner_edges)],
    ([p, e, f, cv, ce]) => x.bm_from_arrays(mesh.verts_num, p, mesh.edges_num, e, mesh.faces_num, f, cv, ce, selectmode));
}

export const editMeshFree = (bm) => x.bm_free(bm);

// The mesh arrays of an edit BMesh, with its selection per domain.
export function meshFromEditMesh(bm) {
  const [verts, edges, faces, corners] = [0, 1, 2, 3].map((i) => x.bm_size(bm, i));
  const out = [new Float32Array(verts * 3), new Int32Array(edges * 2), new Int32Array(faces + 1), new Int32Array(corners), new Int32Array(corners),
    new Uint8Array(verts), new Uint8Array(edges), new Uint8Array(faces)];
  withArrays(out, (pointers) => {
    x.bm_to_arrays(bm, ...pointers);
    out.forEach((a, i) => a.set(new a.constructor(x.memory.buffer, pointers[i], a.length)));
  });
  const [vert_positions, edge_verts, face_offsets, corner_verts, corner_edges, select_vert, select_edge, select_poly] = out;
  return { verts_num: verts, edges_num: edges, faces_num: faces, corners_num: corners, vert_positions, edges: edge_verts, face_offsets,
    corner_verts, corner_edges, select_vert, select_edge, select_poly };
}

// Selection: by index per element type (BM_VERT, BM_EDGE, BM_FACE), recorded in the history as a click is.
export const select = (bm, htype, index) => x.bm_select(bm, htype, index);
export const selectFlush = (bm) => x.bm_select_flush(bm);
export const selectClear = (bm, selectmode) => x.bm_select_clear(bm, selectmode);

const QUAD_METHOD = { BEAUTY: 0, FIXED: 1, FIXED_ALTERNATE: 2, SHORTEST_DIAGONAL: 3, LONGEST_DIAGONAL: 4 };
const NGON_METHOD = { BEAUTY: 0, CLIP: 1 };
const POKE_CENTER = { MEDIAN_WEIGHTED: 0, MEDIAN: 1, BOUNDS: 2 };

// Operators by Blender idname, given the properties set (the rest take their RNA defaults); false when they did nothing.
const run = {
  'mesh.quads_convert_to_tris': (bm, p) => x.mesh_quads_convert_to_tris(bm, QUAD_METHOD[p.quad_method], NGON_METHOD[p.ngon_method]),
  'mesh.tris_convert_to_quads': (bm, p, set) => x.mesh_tris_convert_to_quads(bm, p.face_threshold, 'face_threshold' in set, p.shape_threshold,
    'shape_threshold' in set, p.seam, p.sharp, p.uvs, p.vcols, p.materials, p.topology_influence, p.deselect_joined),
  'mesh.flip_normals': (bm) => x.mesh_flip_normals(bm),
  'mesh.normals_make_consistent': (bm, p) => x.mesh_normals_make_consistent(bm, p.inside),
  'mesh.vertices_smooth': (bm, p) => x.mesh_vertices_smooth(bm, p.factor, p.repeat, p.xaxis, p.yaxis, p.zaxis),
  'mesh.poke': (bm, p) => x.mesh_poke(bm, p.offset, p.use_relative_offset, POKE_CENTER[p.center_mode]),
};
export const editMeshOperators = Object.fromEntries(Object.entries(run).map(([idname, fn]) =>
  [idname, (bm, props = {}) => Boolean(fn(bm, operatorProperties(idname, props), props))]));
