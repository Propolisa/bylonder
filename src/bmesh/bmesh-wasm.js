// Edit Mode in Blender's own code (tools/blender-port/wasm, built by wasm_module.py): Blender's edit mesh lives in the
// module, in a scene with its object in Edit Mode, and is the only one. Operators, selection and transforms change it;
// drawing and picking read the Mesh arrays extracted from it, as Blender's draw cache extracts its buffers from the
// BMesh.
import { instantiate } from '../port/wasm.js';
import { createMesh } from '../blenkernel/mesh/mesh.js';
import { BMESH_WASM } from './bmesh-module.js';

const { exports: x } = await instantiate(BMESH_WASM);

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
// A WebAssembly pointer is an unsigned 32-bit address; exports return it as a signed int.
const cString = (pointer) => {
  const bytes = new Uint8Array(x.memory.buffer, pointer >>> 0);
  return new TextDecoder().decode(bytes.subarray(0, bytes.indexOf(0)));
};
const withString = (text, fn) => withArrays([new TextEncoder().encode(text + '\0')], ([pointer]) => fn(pointer));
// Reads the ints an export writes into a scratch array.
const ints = (length, fn) => withArrays([new Int32Array(length)], ([p]) => { fn(p); return Array.from(new Int32Array(x.memory.buffer, p, length)); });

// The boolean attributes Blender's edit mode reads and writes, in bmesh-api.cc's MeshFlag order, with their domains.
const FLAGS = [['.select_vert', 'POINT'], ['.hide_vert', 'POINT'], ['.select_edge', 'EDGE'], ['.hide_edge', 'EDGE'], ['.uv_seam', 'EDGE'],
  ['sharp_edge', 'EDGE'], ['.select_poly', 'FACE'], ['.hide_poly', 'FACE'], ['sharp_face', 'FACE']];
const bytes = (data) => data && Uint8Array.from(data, Boolean);

const meshArrays = (mesh) => [Float32Array.from(mesh.vert_positions), Int32Array.from(mesh.edges), Int32Array.from(mesh.face_offsets),
  Int32Array.from(mesh.corner_verts), Int32Array.from(mesh.corner_edges), mesh.attribute('UVMap') && Float32Array.from(mesh.attribute('UVMap'))];

// The BMesh of a Mesh with its UV map and flags, in a select mode (SCE_SELECT_*).
function bmFromMesh(mesh, selectmode) {
  const flags = FLAGS.map(([name]) => bytes(mesh.attribute(name)));
  return withArrays([...meshArrays(mesh), ...flags], ([p, e, f, cv, ce, uv, ...flagPointers]) =>
    withArrays([Int32Array.from(flagPointers)], ([table]) => x.bm_from_arrays(mesh.verts_num, p, mesh.edges_num, e, mesh.faces_num, f, cv, ce, uv, table, selectmode)));
}

// Blender's mesh operators by Python idname (mesh.subdivide for MESH_OT_subdivide), registered by their own functions.
const operatorTypes = new Map(Array.from({ length: x.operator_count() }, (_, i) => {
  const [prefix, name] = cString(x.operator_name(i)).split('_OT_');
  return [`${prefix.toLowerCase()}.${name}`, i];
}));
export const hasOperator = (idname) => operatorTypes.has(idname);

// wmOperatorStatus flags.
export const OPERATOR_RUNNING_MODAL = 1, OPERATOR_CANCELLED = 2, OPERATOR_FINISHED = 4;

// What changed since the last extraction (ExtractFlag in extraction.hh): topology, which refills everything, positions
// (with normals and triangles), flags, or the UV map.
export const EXTRACT_TOPOLOGY = 1, EXTRACT_POSITIONS = 2, EXTRACT_FLAGS = 4, EXTRACT_UV = 8, EXTRACT_ALL = 15;

// The Mesh of an extraction (ExtractionHeader): counts, then buffer pointers. Its arrays are views made again when the
// module's memory grows, which detaches the old ones. detach() copies them out, for attachedMesh in another realm.
function extractedMesh(header) {
  const words = Array.from(new Uint32Array(x.memory.buffer, header, 5 + 10 + FLAGS.length + 3));
  const counts = words.slice(0, 5), [verts, edges, faces, corners, tris] = counts, at = (i) => words[5 + i];
  const sizes = { POINT: verts, EDGE: edges, FACE: faces };
  const layout = {
    vert_positions: [Float32Array, at(0), verts * 3], vert_normals: [Float32Array, at(1), verts * 3], face_normals: [Float32Array, at(2), faces * 3],
    edges: [Int32Array, at(3), edges * 2], face_offsets: [Int32Array, at(4), faces + 1], corner_verts: [Int32Array, at(5), corners],
    corner_edges: [Int32Array, at(6), corners], corner_tris: [Int32Array, at(7), tris * 3], tri_faces: [Int32Array, at(8), tris],
    UVMap: [Float32Array, at(9), corners * 2],
    ...Object.fromEntries(FLAGS.map(([name, domain], i) => [name, [Uint8Array, at(10 + i), sizes[domain]]])),
    ...Object.fromEntries(['POINT', 'EDGE', 'FACE'].map((domain, i) => [`orig_index_${domain}`, [Int32Array, at(10 + FLAGS.length + i), sizes[domain]]])),
  };
  let buffer = null, views = {};
  const view = (name) => {
    if (buffer !== x.memory.buffer) [buffer, views] = [x.memory.buffer, {}];
    const [Type, pointer, length] = layout[name];
    return (views[name] ??= new Type(buffer, pointer, length));
  };
  const present = Object.keys(layout).filter((name) => layout[name][1]);
  const mesh = meshOfBuffers(counts, present, view);
  mesh.detach = () => ({ counts, buffers: Object.fromEntries(present.map((name) => [name, view(name).slice()])) });
  return mesh;
}

// A detached extraction ({counts, buffers}) as the Mesh it was.
export const attachedMesh = ({ counts, buffers }) => meshOfBuffers(counts, Object.keys(buffers), (name) => buffers[name]);

// The Mesh of an extraction's counts and the buffers present in it, read through buffer(name).
function meshOfBuffers([verts, edges, faces, corners], present, buffer) {
  const has = (name) => present.includes(name);
  const mesh = createMesh({});
  for (const name of ['vert_positions', 'edges', 'face_offsets', 'corner_verts', 'corner_edges']) Object.defineProperty(mesh, name, { get: () => buffer(name) });
  Object.defineProperties(mesh, { verts_num: { value: verts }, edges_num: { value: edges }, faces_num: { value: faces }, corners_num: { value: corners } });
  const attribute = (name, domain, type) => [name, { domain, type, get data() { return buffer(name); } }];
  mesh.attributes = new Map([...FLAGS.filter(([name]) => has(name)).map(([name, domain]) => attribute(name, domain, 'BOOLEAN')),
    ...(has('UVMap') ? [attribute('UVMap', 'CORNER', 'FLOAT2')] : [])]);
  Object.assign(mesh, {
    corner_tris: () => buffer('corner_tris'),
    corner_tri_faces: () => buffer('tri_faces'),
    face_normals: () => buffer('face_normals'),
    vert_normals: () => buffer('vert_normals'),
    // An evaluated mesh's original element of each of its own in a domain (CD_ORIGINDEX, -1 for none), or null.
    orig_index: (domain) => (has(`orig_index_${domain}`) ? buffer(`orig_index_${domain}`) : null),
  });
  return mesh;
}

// Gives a module Object the modifier stack: each modifier is its type (ModifierType) and a function that writes its
// settings into its ModifierData, given a DataView of the module's memory and the struct's address. Returns their
// ModifierData and a function reading each one's error from its last evaluation, or null.
function setModifiers(object, modifiers) {
  x.modifier_clear(object);
  const added = modifiers.map(({ type, write }) => {
    const md = x.modifier_add(object, type) >>> 0;
    if (!md) throw new Error(`Modifier type ${type} is not in this WebAssembly module`);
    write(new DataView(x.memory.buffer), md);
    return md;
  });
  return { added, errors: () => added.map((md) => (x.modifier_error(md) ? cString(x.modifier_error(md)) : null)) };
}

// Blender's modifier stack on an object's Mesh (modifier-api.cc), as setModifiers takes it. Returns the evaluated Mesh,
// whose arrays are valid until the next evaluation, and each modifier's error or null.
let modifierObject = 0;
export function evaluateModifiers(mesh, modifiers) {
  modifierObject ||= x.modifier_object_new();
  withArrays(meshArrays(mesh), ([p, e, f, cv, ce, uv]) =>
    x.modifier_object_mesh_set(modifierObject, mesh.verts_num, p, mesh.edges_num, e, mesh.faces_num, f, cv, ce, uv));
  const { errors } = setModifiers(x.modifier_object(modifierObject), modifiers);
  return { mesh: extractedMesh(x.modifier_object_eval(modifierObject) >>> 0), errors: errors() };
}

// What Blender's panel of a modifier (as setModifiers takes it) draws with its settings: a tree of layouts and the
// properties, labels and sub-panels in them (panel-layout.cc).
export function drawModifierPanel(modifier) {
  modifierObject ||= x.modifier_object_new();
  const object = x.modifier_object(modifierObject);
  const { added: [md] } = setModifiers(object, [modifier]);
  return JSON.parse(cString(x.modifier_panel_draw(object, md)));
}

// A copy of a Mesh's arrays and attributes, as createMesh takes them, that can be posted to another realm.
export function meshData(mesh) {
  const attributes = Object.fromEntries([...mesh.attributes].map(([name, { domain, type, data }]) => [name, { domain, type, data: data.slice() }]));
  const { vert_positions, edges, face_offsets, corner_verts, corner_edges } = mesh;
  return { vert_positions: vert_positions.slice(), edges: edges.slice(), face_offsets: face_offsets.slice(), corner_verts: corner_verts.slice(), corner_edges: corner_edges.slice(), attributes };
}
// A copy of an extracted Mesh that is its own.
const ownedMesh = (mesh) => createMesh(meshData(mesh));

// A Mesh of positions and faces (offsets into corner vertices) whose edges Blender derives, as a script's
// mesh.update() does.
export const meshFromFaces = (positions, face_offsets, corner_verts) =>
  withArrays([Float32Array.from(positions), Int32Array.from(face_offsets), Int32Array.from(corner_verts)], ([p, f, c]) =>
    ownedMesh(extractedMesh(x.mesh_from_faces(positions.length / 3, p, face_offsets.length - 1, f, c) >>> 0)));

const freeing = new FinalizationRegistry((context) => x.edit_context_free(context));

// Blender's edit mesh (BMEditMesh) and the context its operators run in. Elements are named by type (BM_VERT, BM_EDGE,
// BM_FACE) and index, in the order toMesh() writes them. free() releases it; one left to the garbage collector is
// released then.
export class EditMesh {
  #context;
  #object_to_world = null;

  constructor(bm) {
    this.#context = x.edit_context_new(bm);
    freeing.register(this, this.#context, this);
  }

  // The edit mesh of a Mesh with its UV map and flags, in a select mode (SCE_SELECT_*).
  static fromMesh(mesh, selectmode) {
    return new EditMesh(bmFromMesh(mesh, selectmode));
  }

  get #bm() { return x.edit_context_bmesh(this.#context); }

  free() {
    freeing.unregister(this);
    x.edit_context_free(this.#context);
    this.#context = 0;
  }

  // A copy in the same element order, with the selection history and the object's placement.
  copy() {
    const copy = new EditMesh(x.bm_copy(this.#bm));
    if (this.#object_to_world) copy.objectToWorld = this.#object_to_world;
    return copy;
  }

  // Replaces the BMesh with one of a Mesh, or with a copy of another edit mesh's, as loading an undo step does.
  replace(source) {
    x.edit_context_bmesh_set(this.#context, source instanceof EditMesh ? x.bm_copy(source.#bm) : bmFromMesh(source, this.selectmode));
  }

  get selectmode() { return x.edit_context_selectmode(this.#context); }
  set selectmode(selectmode) { x.edit_context_selectmode_set(this.#context, selectmode); }

  // The object's matrix (column-major, Blender's axes), for what operators do in world space (the 3D cursor).
  set objectToWorld(matrix) {
    this.#object_to_world = matrix;
    withArrays([Float32Array.from(matrix)], ([p]) => x.edit_context_object_matrix_set(this.#context, p));
  }

  // The 3D View's view matrix (column-major, Blender's axes), for what operators do along the view.
  set view(matrix) {
    withArrays([Float32Array.from(matrix)], ([p]) => x.edit_context_view_set(this.#context, p));
  }

  get totals() {
    const [totvert, totvertsel, totedge, totedgesel, totface, totfacesel, totloop] = ints(7, (p) => x.bm_totals(this.#bm, p));
    return { totvert, totvertsel, totedge, totedgesel, totface, totfacesel, totloop };
  }

  // The edit mesh's Mesh as Blender's draw cache extracts it, refilling what changed since the last extraction (EXTRACT_*).
  // Its arrays are views of buffers the edit mesh owns, so it is valid until the next extraction; toMesh() copies.
  extract(what) {
    return extractedMesh(x.edit_mesh_extract(this.#context, what) >>> 0);
  }

  // The object's modifiers evaluated on the edit mesh, as evaluateModifiers takes them: the final Mesh, valid until the
  // next evaluation (null without modifiers), and each modifier's error or null.
  evaluate(modifiers) {
    const { errors } = setModifiers(x.edit_context_object(this.#context), modifiers);
    const header = x.edit_mesh_eval(this.#context) >>> 0;
    return { mesh: header ? extractedMesh(header) : null, errors: errors() };
  }

  // A Mesh of the edit mesh that is its own: arrays, UV map and flags.
  toMesh() {
    return ownedMesh(this.extract(EXTRACT_ALL));
  }

  // Runs a Blender mesh operator's exec, with properties by name (an enum by its item's identifier, an enum flag by a
  // list of them; the rest keep their defaults). Returns its status flags (0 when it does not poll) and the message of
  // the last report it made for the user.
  run(idname, props = {}) {
    const op = x.operator_new(operatorTypes.get(idname));
    try {
      for (const [name, value] of Object.entries(props)) {
        const numbers = Float64Array.from([value].flat(), Number);
        const items = typeof value === 'string' ? value : Array.isArray(value) && value.every((v) => typeof v === 'string') ? value.join(',') : null;
        const ok = withString(name, (namePointer) => items !== null
          ? withString(items, (item) => x.operator_set(op, namePointer, 0, 0, item))
          : withArrays([numbers], ([p]) => x.operator_set(op, namePointer, p, numbers.length, 0)));
        if (!ok) throw new Error(`${idname} has no property ${name} = ${value}`);
      }
      const status = x.operator_exec(this.#context, op), report = x.operator_report(op);
      return { status, report: report ? cString(report) : undefined };
    } finally {
      x.operator_free(op);
    }
  }

  // Whether an operator polls for this edit mesh.
  poll(idname) { return !!x.operator_poll(this.#context, operatorTypes.get(idname)); }

  // An enum property's items as the operator's UI lists them for this edit mesh (its item function, as Blender's
  // menus call it): [identifier, name] pairs.
  enumItems(idname, prop) {
    const text = withString(prop, (name) => cString(x.operator_enum_items(this.#context, operatorTypes.get(idname), name)));
    return text.split('\n').filter(Boolean).map((line) => line.split('\t'));
  }

  // The selection history (BMesh.selected), oldest first, as { htype, index }.
  get history() {
    const bm = this.#bm;
    return withArrays([new Int32Array(1)], ([htype]) => Array.from({ length: x.bm_select_history_len(bm) }, (_, i) => {
      const index = x.bm_select_history_get(bm, i, htype);
      return { htype: new Int32Array(x.memory.buffer, htype, 1)[0], index };
    }));
  }
  set history(history) {
    withArrays([Int32Array.from(history, (ese) => ese.htype), Int32Array.from(history, (ese) => ese.index)],
      ([htypes, indices]) => x.bm_select_history_set(this.#bm, htypes, indices, history.length));
  }

  // A click on an element (index -1 for none) with a select operation (eSelectOp), as EDBM_select_pick applies it.
  selectPick(htype, index, sel_op, deselect_all) {
    return !!x.edit_mesh_select_pick(this.#context, htype, index, sel_op, deselect_all);
  }

  // Selects or deselects elements of one type in order; selectFlush() afterwards flushes by the select mode.
  selectElements(htype, indices, selects) {
    withArrays([Int32Array.from(indices), Uint8Array.from(selects, Boolean)], ([i, s]) => x.bm_select_elements(this.#bm, htype, i, s, indices.length));
  }
  selectFlush() { x.edit_mesh_select_flush(this.#context); }

  // Selects an element and records it in the selection history, as Blender's fixture scripts do.
  select(htype, index) { x.bm_select(this.#bm, htype, index); }
  // Clears the selection and its history and sets the select mode.
  selectClear(selectmode) {
    x.bm_select_clear(this.#bm, selectmode);
    this.selectmode = selectmode;
  }

  // Moves vertices to object-space coordinates (three per vertex).
  setCoords(indices, coords) {
    withArrays([Int32Array.from(indices), Float32Array.from(coords)], ([i, c]) => x.bm_vert_coords_set(this.#bm, i, c, indices.length));
  }
}
