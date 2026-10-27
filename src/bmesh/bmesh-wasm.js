// Edit Mode in Blender's own code (tools/blender-port/wasm/bmesh-api.cc, built by wasm_module.py): the BMesh lives in
// the module, meshes go in and come out as Blender's edit mode orders them, and operators run as Blender's run them.
import { instantiate } from '../port/wasm.js';
import { createMesh } from '../blenkernel/mesh/mesh.js';

const { exports: x } = await instantiate(new URL('./bmesh.wasm', import.meta.url));

// Copies arrays into module memory (null stays a null pointer), runs fn with their pointers, and frees them.
function withArrays(arrays, fn) {
  const pointers = arrays.map((a) => {
    if (!a) return 0;
    const p = x.malloc(a.byteLength) >>> 0;
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

// Writes a Mesh's positions, UV map and flags into an edit BMesh of the same topology, in place.
export function editMeshSync(bm, mesh) {
  const flags = FLAGS.map(([name]) => bytes(mesh.attribute(name)));
  withArrays([Float32Array.from(mesh.vert_positions), mesh.attribute('UVMap') && Float32Array.from(mesh.attribute('UVMap')), ...flags],
    ([p, uv, ...flagPointers]) => withArrays([Int32Array.from(flagPointers)], ([table]) => x.bm_sync(bm, p, uv, table)));
}

export function editMeshFree(bm) {
  editMeshFreeContext(bm);
  x.bm_free(bm);
}

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
// The selection history (BMesh.selected), as { htype, ele } by element index.
export function selectHistorySet(bm, history) {
  withArrays([Int32Array.from(history, (ese) => ese.htype), Int32Array.from(history, (ese) => ese.ele)], ([htypes, indices]) => x.bm_select_history_set(bm, htypes, indices, history.length));
}
export const selectHistory = (bm) => withArrays([new Int32Array(1)], ([htype]) => Array.from({ length: x.bm_select_history_len(bm) }, (_, i) => {
  const ele = x.bm_select_history_get(bm, i, htype);
  return { htype: new Int32Array(x.memory.buffer, htype, 1)[0], ele };
}));
export const translateSelected = (bm, [dx, dy, dz]) => x.bm_translate_selected(bm, dx, dy, dz);
export const objectMatrixSet = (bm, object_to_world) => withArrays([Float32Array.from(object_to_world)], ([p]) => x.edit_context_object_matrix_set(contextOf(bm), p));
export function selectModeSet(bm, selectmode) {
  x.edit_context_selectmode_set(contextOf(bm), selectmode);
}

export function selectClear(bm, selectmode) {
  x.bm_select_clear(bm, selectmode);
  x.edit_context_selectmode_set(contextOf(bm), selectmode);
}

// A WebAssembly pointer is an unsigned 32-bit address; exports return it as a signed int.
const cString = (pointer) => {
  const bytes = new Uint8Array(x.memory.buffer, pointer >>> 0);
  return new TextDecoder().decode(bytes.subarray(0, bytes.indexOf(0)));
};
const withString = (text, fn) => withArrays([new TextEncoder().encode(text + '\0')], ([pointer]) => fn(pointer));

// Blender's mesh operators by Python idname (mesh.subdivide for MESH_OT_subdivide), registered by their own functions.
const operatorTypes = new Map(Array.from({ length: x.operator_count() }, (_, i) => {
  const [prefix, name] = cString(x.operator_name(i)).split('_OT_');
  return [`${prefix.toLowerCase()}.${name}`, i];
}));
export const hasOperator = (idname) => operatorTypes.has(idname);

// The context (a scene with the BMesh's object in Edit Mode) each BMesh runs operators in.
const contexts = new Map();
const contextOf = (bm) => contexts.get(bm) ?? contexts.set(bm, x.edit_context_new(bm)).get(bm);

// wmOperatorStatus flags.
export const OPERATOR_RUNNING_MODAL = 1, OPERATOR_CANCELLED = 2, OPERATOR_FINISHED = 4;

// Runs a Blender mesh operator's exec on a BMesh, with properties by name (an enum by its item's identifier, an enum
// flag by a list of them; the rest keep their defaults). Returns its status flags (0 when it does not poll) and the
// message of the last report it made for the user.
export function runOperator(bm, idname, props = {}) {
  const op = x.operator_new(operatorTypes.get(idname));
  try {
    for (const [name, value] of Object.entries(props)) {
      const numbers = Float64Array.from([value].flat(), Number);
      // An enum by its item's identifier; an enum flag by a list of them.
      const items = typeof value === 'string' ? value : Array.isArray(value) && value.every((v) => typeof v === 'string') ? value.join(',') : null;
      const ok = withString(name, (namePointer) => items !== null
        ? withString(items, (item) => x.operator_set(op, namePointer, 0, 0, item))
        : withArrays([numbers], ([p]) => x.operator_set(op, namePointer, p, numbers.length, 0)));
      if (!ok) throw new Error(`${idname} has no property ${name} = ${value}`);
    }
    const status = x.operator_exec(contextOf(bm), op), report = x.operator_report(op);
    return { status, report: report ? cString(report) : undefined };
  } finally {
    x.operator_free(op);
  }
}

function editMeshFreeContext(bm) {
  if (contexts.has(bm)) x.edit_context_free(contexts.get(bm));
  contexts.delete(bm);
}
