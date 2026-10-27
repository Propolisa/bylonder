// Edit Mode in Blender's own code (tools/blender-port/wasm/bmesh-api.cc, built by wasm_module.py): the BMesh lives in
// the module, meshes go in and come out as Blender's edit mode orders them, and operators run as Blender's run them.
import { instantiate } from '../port/wasm.js';
import { operatorProperties } from '../editors/mesh/editmesh-add.js';
import { createMesh } from '../blenkernel/mesh/mesh.js';

const { exports: x } = await instantiate(new URL('./bmesh.wasm', import.meta.url));

// Copies arrays into module memory (null stays a null pointer), runs fn with their pointers, and frees them.
function withArrays(arrays, fn) {
  const pointers = arrays.map((a) => {
    if (!a) return 0;
    const p = x.malloc(a.byteLength);
    new a.constructor(x.memory.buffer, p, a.length).set(a);
    return p;
  });
  try {
    return fn(pointers);
  } finally {
    pointers.forEach((p) => p && x.free(p));
  }
}

// The boolean attributes Blender's edit mode reads and writes, in bmesh-api.cc's MeshFlag order, with their domains.
const FLAGS = [['.select_vert', 'POINT'], ['.hide_vert', 'POINT'], ['.select_edge', 'EDGE'], ['.hide_edge', 'EDGE'], ['.uv_seam', 'EDGE'],
  ['sharp_edge', 'EDGE'], ['.select_poly', 'FACE'], ['.hide_poly', 'FACE'], ['sharp_face', 'FACE']];
const bytes = (data) => data && Uint8Array.from(data, Boolean);

// The edit BMesh of a Mesh with its UV map and flags, in a select mode (SCE_SELECT_*). Free it with editMeshFree.
export function editMeshFromMesh(mesh, selectmode) {
  const { vert_positions, edges, face_offsets, corner_verts, corner_edges } = mesh;
  const flags = FLAGS.map(([name]) => bytes(mesh.attribute(name)));
  return withArrays([Float32Array.from(vert_positions), Int32Array.from(edges), Int32Array.from(face_offsets), Int32Array.from(corner_verts),
    Int32Array.from(corner_edges), mesh.attribute('UVMap') && Float32Array.from(mesh.attribute('UVMap')), ...flags], ([p, e, f, cv, ce, uv, ...flagPointers]) =>
    withArrays([Int32Array.from(flagPointers)], ([table]) => x.bm_from_arrays(mesh.verts_num, p, mesh.edges_num, e, mesh.faces_num, f, cv, ce, uv, table, selectmode)));
}

export const editMeshFree = (bm) => x.bm_free(bm);

// The Mesh of an edit BMesh, with its UV map and flags.
export function meshFromEditMesh(bm) {
  const [verts, edges, faces, corners] = [0, 1, 2, 3].map((i) => x.bm_size(bm, i));
  const sizes = { POINT: verts, EDGE: edges, FACE: faces };
  const arrays = [new Float32Array(verts * 3), new Int32Array(edges * 2), new Int32Array(faces + 1), new Int32Array(corners), new Int32Array(corners),
    x.bm_has_uv(bm) ? new Float32Array(corners * 2) : null];
  const flags = FLAGS.map(([, domain]) => new Uint8Array(sizes[domain]));
  withArrays([...arrays, ...flags], (pointers) => {
    withArrays([Int32Array.from(pointers.slice(arrays.length))], ([table]) => x.bm_to_arrays(bm, ...pointers.slice(0, arrays.length), table));
    [...arrays, ...flags].forEach((a, i) => a?.set(new a.constructor(x.memory.buffer, pointers[i], a.length)));
  });
  const [vert_positions, edge_verts, face_offsets, corner_verts, corner_edges, uvs] = arrays;
  const attributes = Object.fromEntries(FLAGS.map(([name, domain], i) => [name, { domain, type: 'BOOLEAN', data: flags[i] }]));
  if (uvs) attributes.UVMap = { domain: 'CORNER', type: 'FLOAT2', data: uvs };
  return createMesh({ vert_positions, edges: edge_verts, face_offsets, corner_verts, corner_edges, attributes });
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
