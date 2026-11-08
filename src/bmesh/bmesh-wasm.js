// Blender's own code (tools/blender-port/wasm, built by wasm_module.py): Main (BlenderMain) and its operators, and
// Mesh arrays extracted as Blender's draw cache extracts its buffers.
import { gunzipSync } from 'fflate';
import { instantiate, files, read } from '../port/wasm.js';
import { DATAFILES } from './datafiles.js';
import { createMesh } from '../blenkernel/mesh/mesh.js';
import { BMESH_WASM } from './bmesh-module.js';
import { moduleMesh } from './module-mesh.js';

const { exports: x } = await instantiate(BMESH_WASM);
// Blender's datafiles (its Essentials asset libraries) at its system directory (ghost-paths.cc), read in once the module
// starts; what reads assets (the asset menus, object.modifier_add_node_group) waits for them.
export const datafiles = Promise.all(DATAFILES.map(async ([name, url]) => files.set(`/blender/datafiles/${name}`, new Uint8Array(await read(url)))));
const { withArrays, cString, withString, meshArrays, extractedMesh, attachedMesh, setModifiers, evaluateModifiers } = moduleMesh(x, createMesh);
// A detached extraction ({counts, buffers}) as the Mesh it was; Blender's modifier stack on a Mesh (modifier-api.cc),
// whose result's arrays are valid until the next evaluation, with each modifier's error or null.
export { attachedMesh, evaluateModifiers };


// Blender's mesh operators by Python idname (mesh.subdivide for MESH_OT_subdivide), registered by their own functions.
const operatorTypes = new Map(Array.from({ length: x.operator_count() }, (_, i) => {
  const [prefix, name] = cString(x.operator_name(i)).split('_OT_');
  return [`${prefix.toLowerCase()}.${name}`, i];
}));
export const hasOperator = (idname) => operatorTypes.has(idname);
// The operators that run without a modal session (exec), by idname.
export const execOperators = () => [...operatorTypes].filter(([, i]) => x.operator_has_exec(i)).map(([idname]) => idname);

// The module's exports and memory helpers, for subsystems with API files of their own (anim-api.cc).
export const blenderModule = { exports: x, withArrays, withString, cString };

// A Blender operator with properties by name (an enum by its item's identifier, an enum flag by a list of them; the
// rest keep their defaults), for exec, or for invoke and modal, which keep it while it runs; x.operator_free frees it.
// A type registered after the module's own (a class of Blender's Python, rna-operator.cc) is found by its idname.
export function newOperator(idname, props = {}) {
  const op = operatorTypes.has(idname) ? x.operator_new(operatorTypes.get(idname)) : withString(idname, (p) => x.operator_new_named(p));
  if (!op) throw new Error(`${idname} is not in this WebAssembly module`);
  try {
    setOperatorProperties(op, props);
  } catch (error) {
    x.operator_free(op);
    throw new Error(`${idname}: ${error.message}`);
  }
  return op;
}
// A macro's properties of one of its operators (TRANSFORM_OT_translate in mesh.extrude_region_move's), a dict or a
// keymap item's [name, value] pairs, by their paths ("TRANSFORM_OT_translate.value"). A transpiled Python dict's
// methods are not properties.
const isPairs = (value) => Array.isArray(value) && value.length > 0 && value.every((v) => Array.isArray(v) && typeof v[0] === 'string');
export const flatProperties = (props, prefix = '') => Object.entries(props).filter(([, value]) => typeof value !== 'function').flatMap(([name, value]) =>
  (isPairs(value) || (value && typeof value === 'object' && !Array.isArray(value)) ? flatProperties(isPairs(value) ? Object.fromEntries(value) : value, `${prefix}${name}.`)
    : [[prefix + name, value]]));
export function setOperatorProperties(op, props) {
  for (const [name, value] of flatProperties(props)) {
    const numbers = Float64Array.from([value].flat(), Number);
    const items = typeof value === 'string' ? value : Array.isArray(value) && value.every((v) => typeof v === 'string') ? value.join(',') : null;
    // A string is an enum item's identifier, or else a string property's value (font.text_insert's text).
    const ok = withString(name, (namePointer) => items !== null
      ? withString(items, (item) => x.operator_set(op, namePointer, 0, 0, item))
      : withArrays([numbers], ([p]) => x.operator_set(op, namePointer, p, numbers.length, 0)));
    if (!ok) throw new Error(`no property ${name} = ${value}`);
  }
}
export const operatorReport = (op) => { const report = x.operator_report(op); return report ? cString(report) : undefined; };

// Runs an operator's exec in a context (bContext): its status flags (0 when it does not poll) and the message of the
// last report it made for the user.
function runOperator(C, idname, props) {
  const op = newOperator(idname, props);
  try {
    return { status: x.operator_exec(C, op), report: operatorReport(op) };
  } finally {
    x.operator_free(op);
  }
}
// The popup the last operator a button called opened (operator_popup): { type, title, text }, or null.
export const takeOperatorPopup = () => {
  const type = POPUPS[x.operator_popup()];
  return type ? { type, title: cString(x.operator_popup_title()), text: cString(x.operator_popup_text()) } : null;
};
export const pollOperator = (C, idname) => !!x.operator_poll(C, operatorTypes.get(idname));
export const operatorNames = () => [...operatorTypes.keys()];
// The enum property an operator's invoke offers as a menu (WM_menu_invoke), or null.
function operatorMenuProperty(idname) {
  const op = x.operator_new(operatorTypes.get(idname));
  try {
    const name = x.operator_menu_property(op);
    return name ? cString(name) : null;
  } finally {
    x.operator_free(op);
  }
}
// An enum property's items as the operator's UI lists them in a context (its item function, as Blender's menus call
// it): [identifier, name] pairs.
function operatorEnumItems(C, idname, prop) {
  const text = withString(prop, (name) => cString(x.operator_enum_items(C, operatorTypes.get(idname), name)));
  return text.split('\n').filter(Boolean).map((line) => line.split('\t'));
}

// wmOperatorStatus flags.
// RegionView3D.persp's camera view (DNA_view3d_types.h).
export const RV3D_CAMOB = 2;
export const OPERATOR_RUNNING_MODAL = 1, OPERATOR_CANCELLED = 2, OPERATOR_FINISHED = 4, OPERATOR_PASS_THROUGH = 8;

// Blender's enums by identifier (rna_enum_text): event types (0), event values (1) and property subtypes (2).
export const enumTable = (which) => new Map(cString(x.rna_enum_text(which)).split('\n').filter(Boolean).map((line) => {
  const [identifier, value] = line.split('\t');
  return [identifier, Number(value)];
}));
export const EVENT_TYPES = enumTable(0), EVENT_VALUES = enumTable(1);
// EVT_MODAL_MAP: a modal keymap item's event type.
const EVT_MODAL_MAP = 0x5022;
// The event an operator gets (wm_event_set): { type, value } by identifier or number, or { modal } for a modal keymap
// item; x and y in region pixels, y up; modifier (KM_SHIFT | KM_CTRL | KM_ALT | KM_OSKEY); text; a drag's `press`
// ([x, y]), else its own place.
// The popups an invoke opens (operator_popup), by number.
const POPUPS = [null, 'CONFIRM', 'ENUM_MENU', 'PROPS', 'LAYOUT'];
function wmEvent(C, { type, value = 'PRESS', modal, x: mx = 0, y: my = 0, modifier = 0, text = '', prevType = type, prevValue = value, press }) {
  const code = (table, v) => (typeof v === 'number' ? v : table.get(v) ?? 0);
  const [t, v] = modal === undefined ? [code(EVENT_TYPES, type), code(EVENT_VALUES, value)] : [EVT_MODAL_MAP, modal];
  const event = withString(text, (p) => x.wm_event_set(C, t, v, Math.round(mx), Math.round(my), modifier, p, code(EVENT_TYPES, prevType), code(EVENT_VALUES, prevValue))) >>> 0;
  if (press) x.wm_event_press_set(C, Math.round(press[0]), Math.round(press[1]));
  return event;
}

// What changed since the last extraction (ExtractFlag in extraction.hh): topology, which refills everything, positions
// (with normals and triangles), flags, or the UV map.
export const EXTRACT_TOPOLOGY = 1, EXTRACT_POSITIONS = 2, EXTRACT_FLAGS = 4, EXTRACT_UV = 8, EXTRACT_ALL = 15;
// The index buffers a mesh's draw buffers add to its triangles (extraction.hh DrawRequest).
export const DRAW_LINES = 1, DRAW_LINES_ADJACENCY = 2, DRAW_TANGENTS = 4;
const DRAW_BUFFERS = [['positions', Float32Array, 3], ['normals', Int16Array, 4], ['uvs', Float32Array, 2], ['tris'], ['lines'], ['lines_adjacency'], ['tangents', Int16Array, 4]];
// A tangent's or generic attribute's components (extraction.hh DrawBuffers): their count, and 16-bit normalized ones.
const attributeView = ([data, , type, , count]) => {
  if (!data) return null;
  const size = type & 15, Type = type & 16 ? Uint16Array : type & 32 ? Int16Array : Float32Array;
  return { data: new Type(x.memory.buffer, data >>> 0, count * size), size, normalized: Type !== Float32Array };
};
// A mesh's draw buffers as Blender's draw cache extracts them (draw-mesh.cc), in Babylon's axes, as views of the module's
// memory until the next extraction: per face corner, then per loose edge's and loose vertex's point, its position, its
// normal (16-bit snorm, xyz and a 0) and its UV; the triangles sorted by material slot, with each slot's count; the face
// edges and the outline's edges with their adjacent corners, and the active UV map's tangents (16-bit snorm, in Blender's
// axes), when asked; the generic attributes asked for by name (attributeView), in order; absent ones null. free() lets
// their memory go.
function drawBuffers(header) {
  if (!header) return null;
  const words = new Int32Array(x.memory.buffer, header >>> 0, DRAW_BUFFERS.length * 5 + 4);
  const view = ([, Type, size], i) => {
    const [data, , type, , count] = words.subarray(i * 5, i * 5 + 5);
    return data ? new (Type ?? (type === 32 ? Uint32Array : Uint16Array))(x.memory.buffer, data >>> 0, count * (size ?? 1)) : null;
  };
  const slots = words[DRAW_BUFFERS.length * 5], counts = slots ? Array.from(new Int32Array(x.memory.buffer, words[DRAW_BUFFERS.length * 5 + 1] >>> 0, slots)) : [];
  const [count, list] = words.subarray(DRAW_BUFFERS.length * 5 + 2), table = count ? new Int32Array(x.memory.buffer, list >>> 0, count * 5) : [];
  const attributes = Array.from({ length: count }, (_, i) => attributeView(table.subarray(i * 5, i * 5 + 5)));
  return { ...Object.fromEntries(DRAW_BUFFERS.map((entry, i) => [entry[0], view(entry, i)])), tris_by_material: counts, attributes, free: () => x.draw_buffers_free() };
}

// A copy of a Mesh's arrays and attributes, as createMesh takes them, that can be posted to another realm.
export function meshData(mesh) {
  const attributes = Object.fromEntries([...mesh.attributes].map(([name, { domain, type, data }]) => [name, { domain, type, data: data.slice() }]));
  const { vert_positions, edges, face_offsets, corner_verts, corner_edges } = mesh;
  return { vert_positions: vert_positions.slice(), edges: edges.slice(), face_offsets: face_offsets.slice(), corner_verts: corner_verts.slice(), corner_edges: corner_edges.slice(), attributes };
}
// A copy of an extracted Mesh that is its own.
// A Float32Array of the module's memory as a property read anew each time: a view made before a call that grows the
// memory is detached by it.
const floatsView = (record, name, pointer, length) =>
  Object.defineProperty(record, name, { enumerable: true, get: () => new Float32Array(x.memory.buffer, pointer >>> 0, length) });
const ownedMesh = (mesh) => createMesh(meshData(mesh));

// A Mesh of positions and faces (offsets into corner vertices) whose edges Blender derives, as a script's
// mesh.update() does.
export const meshFromFaces = (positions, face_offsets, corner_verts) =>
  withArrays([Float32Array.from(positions), Int32Array.from(face_offsets), Int32Array.from(corner_verts)], ([p, f, c]) =>
    ownedMesh(extractedMesh(x.mesh_from_faces(positions.length / 3, p, face_offsets.length - 1, f, c) >>> 0)));


// IDRecalcFlag: what the depsgraph evaluates again of an ID tagged with it (0 for all of it).
// The shapes an instance group draws (main-api.cc ParticleShape): an object's, or what Blender's overlay expands a
// particle into.
// Object.mode's items (rna_object.cc rna_enum_object_mode_items) as eObjectMode flags.
export const OBJECT_MODES = { OBJECT: 0, EDIT: 1, SCULPT: 2, VERTEX_PAINT: 4, WEIGHT_PAINT: 8, TEXTURE_PAINT: 16, PARTICLE_EDIT: 32, POSE: 64,
  EDIT_GPENCIL: 128, PAINT_GREASE_PENCIL: 256, SCULPT_GREASE_PENCIL: 512, WEIGHT_GREASE_PENCIL: 1024, VERTEX_GREASE_PENCIL: 2048, SCULPT_CURVES: 4096 };
const OBJECT_MODES_BY_FLAG = new Map(Object.entries(OBJECT_MODES).map(([name, flag]) => [flag, name]));
export const INSTANCE_SHAPES = ['OBJECT', 'DOT', 'CIRCLE', 'CROSS', 'AXIS', 'MESH'];
export const ID_RECALC_TRANSFORM = 1 << 0, ID_RECALC_GEOMETRY = 1 << 1, ID_RECALC_SHADING = 1 << 7, ID_RECALC_SYNC_TO_EVAL = 1 << 13, ID_RECALC_ALL = 0xffffffff;
// ID codes (DNA_ID_enums.h): Image.
const ID_IM = 0x4d49;
const OBJECT_TYPES = { EMPTY: 0, MESH: 1, CURVE: 2, FONT: 4, LIGHT: 10, CAMERA: 11, ARMATURE: 25 };
const ROTATION_MODES = ['QUATERNION', 'XYZ', 'XZY', 'YXZ', 'YZX', 'ZXY', 'ZYX'];
// A Mesh attribute's AttrDomain, and its AttrType with the array of its values and their number per element.
const DOMAINS = { POINT: 0, EDGE: 1, FACE: 2, CORNER: 3 };
// eBaseFlags, and the bit main_base_get adds for the active base.
const BASE_SELECTED = 1 << 0, BASE_HIDDEN = 1 << 8, BASE_ACTIVE = 1 << 30;
// The addresses an export writes when given an array, after it counted them without one.
const addresses = (fn) => {
  const count = fn(0);
  return withArrays([new Uint32Array(count)], ([p]) => { fn(p); return Array.from(new Uint32Array(x.memory.buffer, p >>> 0, count)); });
};

const DOMAIN_SIZES = { POINT: 'verts_num', EDGE: 'edges_num', FACE: 'faces_num', CORNER: 'corners_num' };
// Node sockets' eNodeSocketDatatype and PropertySubType by idname (SOCK_FLOAT, SOCK_VECTOR, SOCK_RGBA, SOCK_SHADER;
// PROP_FACTOR, PROP_DIRECTION).
const SOCKET_TYPES = { NodeSocketFloat: [0, 0], NodeSocketFloatFactor: [0, 15], NodeSocketVector: [1, 0], NodeSocketVectorDirection: [1, 22],
  NodeSocketColor: [2, 0], NodeSocketShader: [3, 0] };
const ATTRIBUTE_TYPES = { BOOLEAN: [0, Uint8Array, 1], INT: [3, Int32Array, 1], FLOAT: [5, Float32Array, 1], FLOAT2: [6, Float32Array, 2] };
const ATTRIBUTE_TYPE_NAMES = new Map(Object.entries(ATTRIBUTE_TYPES).map(([name, [code]]) => [code, name]));
const DOMAIN_NAMES = Object.keys(DOMAINS);
// Bylonder's Mesh attribute names that Blender 5.2's Mesh names otherwise.
const MAIN_NAMES = new Map([['.uv_seam', 'uv_seam']]), OWN_NAMES = new Map([...MAIN_NAMES].map(([own, main]) => [main, own]));

// Blender's data outside Edit Mode (main-api.cc): a Main of objects and their data, a scene whose view layer holds the
// selection and the active object, and the context operators run in. Other subsystems add their IDs to `bmain` and
// reach an object's data by `data(ob)`. An object is named by the address
// add() gives; transforms are in Blender's axes, matrices column-major, as an object's RNA names them.
let current = null;
const makeCurrent = (main) => { current = main; x.rna_context_set(main.C); };
export class BlenderMain {
  #context = x.main_new();
  #C = x.main_C(this.#context);
  #undo = false;

  constructor() { makeCurrent(this); }

  // Runs fn with this Main as Blender's current one (G_MAIN, RNA's context), which RNA's updates tag IDs in.
  current(fn) {
    const previous = current;
    makeCurrent(this);
    try {
      return fn(this);
    } finally {
      makeCurrent(previous);
    }
  }

  // An object of a type (EMPTY, MESH, CURVE, FONT, LIGHT, CAMERA) with new data of its type.
  add(type, name) { return withString(name, (p) => x.main_object_add(this.#context, OBJECT_TYPES[type], p)) >>> 0; }
  remove(ob) { x.main_object_remove(this.#context, ob); }

  // Its base in the view layer: whether its collection shows it, whether it is hidden, unselectable, selected or active.
  setBase(ob, { visible = true, hidden = false, hide_select = false, select = false, active = false }) {
    x.main_base_set(this.#context, ob, visible, hidden, hide_select, select, active);
  }
  setParent(ob, parent) { x.object_parent_set(ob, parent ?? 0); }
  // An object's mode (Object.mode, OBJECT_MODES), Main's.
  mode(ob) { return OBJECT_MODES_BY_FLAG.get(x.object_mode(ob)) ?? 'OBJECT'; }
  setMode(ob, mode) { x.object_mode_set(ob, OBJECT_MODES[mode] ?? 0); }

  // The object's DNA (ObjectFields in main-api.cc), read and written in place.
  #fields(ob) {
    const [location, euler, quaternion, scale, mode, parentinv, world, recalc, dataRecalc] = new Uint32Array(x.memory.buffer, x.object_fields(ob) >>> 0, 9);
    const floats = (p, n) => new Float32Array(x.memory.buffer, p >>> 0, n);
    return { location: floats(location, 3), rotation_euler: floats(euler, 3), rotation_quaternion: floats(quaternion, 4), scale: floats(scale, 3),
      rotation_mode: new Int16Array(x.memory.buffer, mode >>> 0, 1), matrix_parent_inverse: floats(parentinv, 16), matrix_world: floats(world, 16),
      recalc: new Uint32Array(x.memory.buffer, recalc >>> 0, 1), dataRecalc: dataRecalc && new Uint32Array(x.memory.buffer, dataRecalc >>> 0, 1) };
  }
  // location, rotation_mode, rotation_euler, rotation_quaternion, scale, matrix_parent_inverse and matrix_world.
  transform(ob) {
    const { rotation_mode, recalc, dataRecalc, ...arrays } = this.#fields(ob);
    return { rotation_mode: ROTATION_MODES[rotation_mode[0]], ...Object.fromEntries(Object.entries(arrays).map(([name, values]) => [name, Array.from(values)])) };
  }
  // Writes what it is given of transform()'s values but matrix_world, which evaluate() gives.
  setTransform(ob, { rotation_mode, matrix_world, ...arrays }) {
    const fields = this.#fields(ob);
    if (rotation_mode) fields.rotation_mode[0] = ROTATION_MODES.indexOf(rotation_mode);
    for (const [name, values] of Object.entries(arrays)) fields[name].set(values);
    this.tag(ob, ID_RECALC_TRANSFORM);
  }
  // Places an object at a world matrix (column-major, Blender's axes) as Blender's transform applies one.
  applyWorldMatrix(ob, matrix) { withArrays([Float32Array.from(matrix)], ([p]) => x.object_world_matrix_apply(ob, p)); }
  // Folds an object's parent inverse into its own transform, keeping where it is.
  foldParentInverse(ob) { x.object_parent_inverse_fold(ob); }

  // An ID the editor wrote into, tagged for the depsgraph (ID_RECALC_*, 0 for all of it); relations between IDs (a
  // parent, a modifier's target) changed.
  tag(id, flags = 0) { x.id_tag_update(id, flags); }
  relationsChanged() { x.main_relations_tag(this.#context); }
  // What the last operator tagged for an update (ID_RECALC_*) on an object and on its data, until evaluate().
  tags(ob) {
    const { recalc, dataRecalc } = this.#fields(ob);
    return { object: recalc[0], data: dataRecalc?.[0] ?? 0 };
  }

  // The scene's 3D cursor location and its pivot point (V3D_AROUND_*), which operators read.
  set cursor(location) { new Float32Array(x.memory.buffer, x.main_cursor(this.#context) >>> 0, 3).set(location); }
  set pivotPoint(pivot) { x.main_pivot_point_set(this.#context, pivot); }
  // The scene's active camera object (or null).
  set camera(ob) { x.main_scene_camera_set(this.#context, ob ?? 0); }
  // The field of view a camera object frames a width by height image with, along the side its sensor fits, whether
  // that side is the height, and its Shift as the view's offset in clip space (main-api.cc camera_view_fov).
  cameraViewFov(ob, width, height) {
    const [fov, vertical, x0, y0] = new Float32Array(x.memory.buffer, x.camera_view_fov(ob, width, height) >>> 0, 4);
    return { fov, vertical: vertical > 0, shift: [x0, y0] };
  }
  // A camera object's depth of field (main-api.cc camera_dof): its focus distance, f-stop and focal length, or null
  // when it has none (or the module predates it).
  cameraDof(ob) {
    if (!x.camera_dof) return null;
    const [on, focusDistance, fStop, lens] = new Float32Array(x.memory.buffer, x.camera_dof(ob) >>> 0, 5);
    return on ? { focusDistance, fStop, lens } : null;
  }

  // Main evaluated by Blender's depsgraph for what was tagged; clears the tags.
  evaluate() { x.main_evaluate(this.#context); }
  // The scene's statistics as Blender's status bar shows them (main-api.cc main_statistics).
  statistics() { return cString(x.main_statistics(this.#context)); }
  // The scene at a frame, evaluated by its depsgraph (animation, drivers and what depends on them).
  set frame(frame) { x.view_frame_set(this.#C, frame); }
  // The curves Main's objects draw (main-api.cc main_curves): their evaluated curves (system -1) and particle hair,
  // { ob, system, render (the render engines draw it), viewport (Workbench and, in Wireframe, the overlay do), overlay
  // (the overlay always does: its viewport display is Path), material (Main's Material, or 0), faces (the Hair shape's
  // faces per segment), objectToWorld, posRad (each evaluated point's position, object space, and radius), indirection, time (each point's
  // along its curve, 0 to 1), length (each curve's) }, the arrays views
  // into the module's memory valid until the next call.
  curves() {
    const count = x.main_curves(this.#context), at = x.main_curves_draws() >>> 0, words = 29, memory = x.memory.buffer;
    const [posRad, indirection, time, length] = [x.main_curves_pos_rad(), x.main_curves_indirection(), x.main_curves_time(), x.main_curves_length()].map((p) => p >>> 0);
    const ints = new Int32Array(memory, at >>> 0, count * words), floats = new Float32Array(memory, at >>> 0, count * words);
    return Array.from({ length: count }, (_, i) => {
      const [ob, system, render, viewport, overlay, material, faces, firstPoint, points, firstIndirection, indirections, firstCurve, curves] = ints.subarray(i * words, i * words + 13);
      return { ob: ob >>> 0, system, render: !!render, viewport: !!viewport, overlay: !!overlay, material: material >>> 0, faces, objectToWorld: floats.subarray(i * words + 13, i * words + 29),
        posRad: new Float32Array(memory, (posRad >>> 0) + firstPoint * 16, points * 4), indirection: new Int32Array(memory, (indirection >>> 0) + firstIndirection * 4, indirections),
        time: new Float32Array(memory, (time >>> 0) + firstPoint * 4, points), length: new Float32Array(memory, (length >>> 0) + firstCurve * 4, curves) };
    });
  }
  // The visible drawings of Main's Grease Pencil objects (grease-pencil-api.cc main_grease_pencil), onion skins where
  // `onion`: { ob, layer (its index), onion (0, or the onion skin's distance before or after the frame), changed (packed
  // anew; else curves, points and triangles are empty and the last ones stand; all of them with `repack`), blend (the
  // layer's blend mode), pointsShown (Edit Mode's points are drawn), layerToWorld (Blender's matrix), curves (CURVE_INTS per curve: first point, points, flags,
  // material index, hash), points (POINT_FLOATS per point: position in Babylon's axes, radius, stroke color, fill color,
  // selection, weight), triangles (the fills', by point) }, views into the module's memory valid until the next call.
  greasePencil({ onion = true, repack = false } = {}) {
    const count = x.main_grease_pencil(this.#C, onion, repack), words = 28, memory = x.memory.buffer, at = x.main_grease_pencil_draws() >>> 0;
    const [curves, points, triangles] = [x.main_grease_pencil_curves(), x.main_grease_pencil_points(), x.main_grease_pencil_triangles()].map((p) => p >>> 0);
    const ints = new Int32Array(memory, at >>> 0, count * words), floats = new Float32Array(memory, at >>> 0, count * words);
    return Array.from({ length: count }, (_, i) => {
      const [ob, layer, onionId, changed, blend, pointsShown, firstCurve, curveCount, firstPoint, pointCount, firstTriangle, triangleCount] = ints.subarray(i * words, i * words + 12);
      return { ob: ob >>> 0, layer, onion: onionId, changed: !!changed, blend, pointsShown: !!pointsShown, layerToWorld: floats.subarray(i * words + 12, i * words + 28),
        curves: new Int32Array(memory, (curves >>> 0) + firstCurve * 20, curveCount * 5), points: new Float32Array(memory, (points >>> 0) + firstPoint * 56, pointCount * 14),
        triangles: new Uint32Array(memory, (triangles >>> 0) + firstTriangle * 12, triangleCount * 3) };
    });
  }
  // The active object's Particle Edit Mode as Blender's overlay draws it (main-api.cc main_particle_edit), or null:
  // { useWeight, showInner, showTips, strands, inner, tips (points of 4 floats: world position in Blender's axes,
  // selection), indices (the strands' line strips, 0xFFFFFFFF between) }, views into the module's memory valid until
  // the next call.
  particleEdit() {
    if (!x.main_particle_edit(this.#context)) return null;
    const [strands, indices, inner, tips, flags] = new Int32Array(x.memory.buffer, x.main_particle_edit_record() >>> 0, 5), points = x.main_particle_edit_points() >>> 0;
    const part = (first, count) => new Float32Array(x.memory.buffer, (points >>> 0) + first * 16, count * 4);
    return { useWeight: !!(flags & 1), showInner: !!(flags & 2), showTips: !!(flags & 4), strands: part(0, strands), inner: part(strands, inner), tips: part(strands + inner, tips),
      indices: new Uint32Array(x.memory.buffer, x.main_particle_edit_indices() >>> 0, indices) };
  }
  // What Main's objects draw as instances (main-api.cc main_instances): groups of one shape, { instancer, ob (the
  // object instanced, or 0), shape (INSTANCE_SHAPES), overlay (drawn in the viewport only), drawSize, color, geometry
  // (a MESH group's Mesh, for instanceMesh), material (the geometry's first Material, or 0), data (16 floats per
  // instance: a world matrix in Babylon's layout, else a particle's point data in Blender's axes: position, value,
  // rotation) }, the data a view into the module's memory made on each read (other calls can grow the memory, which
  // detaches older views), valid until the next instances().
  instances() {
    const count = x.main_instances(this.#context), at = x.main_instance_groups() >>> 0, data = x.main_instance_matrices() >>> 0, size = 12;
    const ints = new Int32Array(x.memory.buffer, at >>> 0, count * size), floats = new Float32Array(x.memory.buffer, at >>> 0, count * size);
    return Array.from({ length: count }, (_, i) => {
      const [instancer, ob, shape, overlay, first, n] = ints.subarray(i * size, i * size + 6), [geometry, material] = ints.subarray(i * size + 10, i * size + 12);
      return floatsView({ instancer: instancer >>> 0, ob: ob >>> 0, shape: INSTANCE_SHAPES[shape], overlay: !!overlay, drawSize: floats[i * size + 6],
        color: Array.from(floats.subarray(i * size + 7, i * size + 10)), geometry: geometry >>> 0, material: material >>> 0 }, 'data', data + first * 64, n * 16);
    });
  }
  // The Mesh of an instances() MESH group, valid until the next call.
  instanceMesh(mesh) { return extractedMesh(x.main_instance_mesh(this.#context, mesh) >>> 0); }
  // An object's dupli list (main-api.cc main_duplis, object_duplilist), the reference instances() is checked against:
  // { ob (an object instanced), data (a mesh instanced), matrix (16 floats, Babylon's layout) }, a copy.
  duplis(ob) {
    const count = x.main_duplis(this.#context, ob), at = x.main_dupli_records() >>> 0, size = 18;
    const ints = new Int32Array(x.memory.buffer, at >>> 0, count * size);
    return Array.from({ length: count }, (_, i) => ({ ob: ints[i * size] >>> 0, data: ints[i * size + 1] >>> 0,
      matrix: Array.from(new Float32Array(x.memory.buffer, (at >>> 0) + (i * size + 2) * 4, 16)) }));
  }
  // The point clouds the last instances() found (main-api.cc main_pointclouds): { instancer, pointcloud, material,
  // matrix (16 floats, Babylon's layout), points (4 floats each: position in Blender's axes, radius) }, the arrays views
  // into the module's memory made on each read, valid until the next instances().
  pointClouds() {
    const count = x.main_pointclouds(), size = 21, at = x.main_pointcloud_draws() >>> 0, points = x.main_pointcloud_points() >>> 0;
    const ints = new Int32Array(x.memory.buffer, at >>> 0, count * size);
    return Array.from({ length: count }, (_, i) => {
      const [instancer, pointcloud, material] = ints.subarray(i * size, i * size + 3), [first, n] = ints.subarray(i * size + 19, i * size + 21);
      const record = floatsView({ instancer: instancer >>> 0, pointcloud: pointcloud >>> 0, material: material >>> 0 }, 'matrix', at + (i * size + 3) * 4, 16);
      return floatsView(record, 'points', points + first * 16, n * 4);
    });
  }
  // The IDs the depsgraph updated since the last call, each with its recalc flags (ID_RECALC_*): { id, recalc }.
  updates() { return Array.from({ length: x.main_updates() }, (_, i) => ({ id: x.main_update(i) >>> 0, recalc: x.main_update_recalc(i) >>> 0 })); }

  // A mesh object's Mesh, with the attributes Blender's Mesh has types for.
  setMesh(ob, mesh) {
    withArrays(meshArrays(mesh).slice(0, 5), ([p, e, f, cv, ce]) =>
      x.object_mesh_set(ob, mesh.verts_num, p, mesh.edges_num, e, mesh.faces_num, f, cv, ce));
    for (const [name, { domain, type, data }] of mesh.attributes) {
      const [code, Type] = ATTRIBUTE_TYPES[type] ?? [];
      if (Type) withString(MAIN_NAMES.get(name) ?? name, (p) => withArrays([Type.from(data)], ([values]) => x.object_mesh_attribute_add(ob, p, DOMAINS[domain], code, values)));
    }
  }
  // A copy of a mesh object's Mesh with its attributes of the types Bylonder's meshes hold (mesh_attributes_list).
  mesh(ob) {
    const listed = cString(x.mesh_attributes_list(ob)).split('\n').filter(Boolean).map((line) => line.split('\t'))
      .map(([name, domain, type]) => [name, { domain: DOMAIN_NAMES[domain], type: ATTRIBUTE_TYPE_NAMES.get(Number(type)) }]).filter(([, { type }]) => type);
    const mesh = extractedMesh(x.object_mesh_extract(this.#context, ob) >>> 0);
    mesh.attributes = new Map(listed.map(([name, { domain, type }]) => {
      const [, Type, size] = ATTRIBUTE_TYPES[type], pointer = withString(name, (p) => x.object_mesh_attribute(ob, p)) >>> 0;
      // A view made when read: reading the next attribute's name allocates, which can grow the memory.
      return [OWN_NAMES.get(name) ?? name, { domain, type, get data() { return new Type(x.memory.buffer, pointer >>> 0, mesh[DOMAIN_SIZES[domain]] * size); } }];
    }));
    return ownedMesh(mesh);
  }
  // The 3D View the context's operators run in picks as in X-ray (view-api.cc's seam: no GPU select buffer).
  xrayPicking() { x.view_xray_picking(this.#C); }
  // The edit mesh of an object in Edit Mode (its Mesh's BMEditMesh), as the draw cache extracts it (view-api.cc), valid
  // until its next extraction, and its select mode (SCE_SELECT_*); null outside Edit Mode.
  editMesh(ob, what = EXTRACT_ALL) {
    const header = x.view_edit_mesh_extract(ob, what) >>> 0;
    return header ? { mesh: extractedMesh(header), selectmode: x.view_edit_mesh_selectmode(ob) } : null;
  }
  // An object's evaluated mesh as the depsgraph evaluated it (a mesh's with its modifiers, a curve's or text's as Blender
  // draws it), valid until the next call, or null when it has none.
  evaluatedMesh(ob) {
    const header = x.object_mesh_eval(this.#context, ob) >>> 0;
    if (!header) return null;
    const mesh = extractedMesh(header), slots = x.extracted_material_index() >>> 0;
    if (slots) mesh.attributes.set('material_index', { domain: 'FACE', type: 'INT', get data() { return new Int32Array(x.memory.buffer, slots >>> 0, mesh.faces_num); } });
    mesh.drawBuffers = (what = 0, attributes = []) => withString(attributes.join('\n'), (names) => drawBuffers(x.object_draw_buffers(this.#context, ob, what, names) >>> 0));
    return mesh;
  }
  // A lasso gesture's path in the view's region pixels, for view3d.select_lasso's exec (anim-api.cc).
  set lassoPath(path) { withArrays([Int32Array.from(path.flat())], ([p]) => x.gesture_lasso_path_set(p, path.length)); }
  // The weight of each vertex of the mesh evaluatedMesh last gave, as Weight Paint Mode's overlay draws it (main-api.cc
  // mesh_paint_weights), a copy.
  paintWeights(ob, count) { return new Float32Array(x.memory.buffer, x.mesh_paint_weights(this.#context, ob) >>> 0, count).slice(); }
  // The active color attribute of the mesh evaluatedMesh last gave, per face corner in scene linear RGBA (main-api.cc
  // extracted_color), a copy; null without one.
  paintColors(count) { const p = x.extracted_color(0) >>> 0; return p ? new Float32Array(x.memory.buffer, p >>> 0, count * 4).slice() : null; }
  // An object's modifier stack, as setModifiers takes it: their errors from the last evaluation.
  setModifiers(ob, modifiers) {
    const { errors } = setModifiers(ob, modifiers);
    this.tag(ob, ID_RECALC_GEOMETRY);
    this.relationsChanged();
    return errors;
  }
  // An object's modifiers as Main holds them: each one's type (ModifierType), name, mode (ModifierMode), address and
  // the error it reported in its last evaluation (or null).
  modifiers(ob) {
    const list = [];
    for (let md; (md = x.object_modifier(ob, list.length) >>> 0);) {
      list.push({ type: x.modifier_type(md), name: cString(x.modifier_name(md)), mode: x.modifier_mode(md), md, error: x.modifier_error(md) ? cString(x.modifier_error(md)) : null });
    }
    return list;
  }
  // Blender's modifier operators on an object's stack (main-api.cc): add (a ModifierType; its ModifierData), remove,
  // move to an index, copy after itself, rename (unique in the stack) and apply to its data.
  addModifier(ob, type) { return x.object_modifier_add(this.#context, ob, type) >>> 0; }
  removeModifier(ob, md) { return x.object_modifier_remove(this.#context, ob, md); }
  moveModifier(ob, md, index) { return x.object_modifier_move(ob, md, index); }
  copyModifier(ob, md) { return x.object_modifier_copy(this.#context, ob, md); }
  renameModifier(ob, md, name) { withString(name, (p) => x.object_modifier_rename(ob, md, p)); }
  applyModifier(ob, md) { return x.object_modifier_apply(this.#context, ob, md); }

  // Materials and worlds, by address: their users are those that use them.
  addMaterial(name) { return withString(name, (p) => x.main_material_add(this.#context, p)) >>> 0; }
  addWorld(name) { return withString(name, (p) => x.main_world_add(this.#context, p)) >>> 0; }
  removeID(id) { x.main_id_remove(this.#context, id); }
  users(id) { return x.id_users(id); }
  setFakeUser(id, fake) { x.id_fake_user_set(id, fake); }
  fakeUser(id) { return !!x.id_fake_user(id); }
  get world() { return x.main_scene_world(this.#context) >>> 0; }
  set world(world) { x.main_scene_world_set(this.#context, world ?? 0); }
  // An object's material slots (0 for an empty one), set whole on its data.
  setMaterials(ob, materials) {
    withArrays([Uint32Array.from(materials)], ([p]) => x.object_materials_set(this.#context, ob, p, materials.length));
  }
  materials(ob) { return addresses((p) => x.object_materials(ob, p)); }
  // The slots an object draws with, its evaluated geometry's (main-api.cc object_materials_eval): Geometry Nodes' Set
  // Material can add ones the object lacks.
  drawnMaterials(ob) { return addresses((p) => x.object_materials_eval(this.#context, ob, p)); }
  // An ID's custom string property (null when it has none), for what only Bylonder has.
  setProperty(id, name, value) { withString(name, (n) => withString(value, (v) => x.id_property_string_set(id, n, v))); }
  property(id, name) { const p = withString(name, (n) => x.id_property_string(id, n)) >>> 0; return p ? cString(p) : null; }

  // A Material's or World's node tree, set whole from { nodes: [{ idname, name, location, width, inputs, outputs }],
  // links: [[from node, output, to node, input]] }, a socket being { identifier, name, socket (its idname, as
  // NodeSocketColor), value }; and as Main holds it ({ nodes: [{ idname, name, inputs: { identifier: value } }], links }).
  setNodeTree(owner, { nodes, links }) {
    x.node_tree_clear(this.#context, owner);
    const made = new Map(), linked = new Set(links.map(([, , to, input]) => `${to}:${input}`));
    for (const { idname, name, location = [0, 0], width = 140, inputs = [], outputs = [] } of nodes) {
      const node = withString(idname, (i) => withString(name, (n) => x.node_add(owner, i, n, location[0], location[1], width))) >>> 0;
      const sockets = new Map();
      // An input without a value or link is left out: Blender's node type adds it with its default when the file is read.
      const given = inputs.filter(({ identifier, value }) => (value ?? null) !== null || linked.has(`${name}:${identifier}`));
      for (const [output, list] of [[false, given], [true, outputs]]) for (const { identifier, name: label = identifier, socket, value } of list) {
        const [type, subtype] = SOCKET_TYPES[socket];
        const values = Float32Array.from(value === null || value === undefined ? [] : [value].flat());
        const pointer = withString(identifier, (i) => withString(label, (n) => withArrays([values], ([v]) =>
          x.node_socket_add(owner, node, output, type, subtype, i, n, values.length ? v : 0, values.length)))) >>> 0;
        sockets.set((output ? 'out:' : 'in:') + identifier, pointer);
      }
      made.set(name, { node, sockets });
    }
    for (const [from, output, to, input] of links) {
      const a = made.get(from), b = made.get(to);
      x.node_link_add(owner, a.node, a.sockets.get('out:' + output), b.node, b.sockets.get('in:' + input));
    }
    x.node_tree_updated(this.#context, owner);
    this.tag(owner, ID_RECALC_SHADING);
    this.relationsChanged();
  }
  nodeTree(owner) { return JSON.parse(cString(x.node_tree_describe(owner))); }
  // A node tree that is its own ID (a node group, the scene's compositing node group), as nodeTree gives an ID's.
  nodeGroup(tree) { return JSON.parse(cString(x.node_tree_inlined_describe(tree))); }
  // fn(tree) with an ID's shader node tree as EEVEE compiles it (main-api.cc node_tree_inlined): its node groups and
  // closures inlined, its repeat zones kept, as nodeTree gives a tree, with `id` (the inlined tree, an ID outside
  // Main, for its nodes' RNA) and `errors` (what inlining reported), freed after.
  withInlinedNodeTree(owner, fn) {
    const id = x.node_tree_inlined(owner) >>> 0, errors = cString(x.node_tree_inlined_errors()).split('\n').filter(Boolean);
    try {
      return fn({ ...JSON.parse(cString(x.node_tree_inlined_describe(id))), id, errors });
    } finally {
      x.node_tree_inlined_free(id);
    }
  }

  // The Main's address and an object's data's address (0 for an empty), for subsystems with their own exports.
  get bmain() { return x.main_bmain(this.#context) >>> 0; }
  get scene() { return x.main_scene(this.#context) >>> 0; }
  // The scene's display transform on a size^3 lattice of shaped colors (a log shaper over `stops` below its range, else
  // pow 2.2) and the scene linear range it spans (image-api.cc display_lut), a copy; null with a module that has none.
  displayLut(size, stops = 0) {
    if (!x.display_lut) return null;
    const p = x.display_lut(this.scene, size, stops) >>> 0, view = new DataView(x.memory.buffer, p, 8);
    const rgba = view.getUint32(0, true), range = view.getFloat32(4, true);
    return { rgba: new Float32Array(x.memory.buffer, rgba >>> 0, size ** 3 * 4).slice(), range };
  }
  // Scene linear RGB colors through the same display transform, as Blender displays each pixel.
  displayTransform(rgb) { return withArrays([Float32Array.from(rgb)], ([p]) => { x.display_transform_apply(this.scene, p, rgb.length / 3); return new Float32Array(x.memory.buffer, p >>> 0, rgb.length).slice(); }); }
  get C() { return this.#C; }
  data(ob) { return x.object_data(ob) >>> 0; }

  // The context its operators run in (bContext).
  get C() { return this.#C; }
  // Collections, by address: the Scene Collection holds the rest. A collection's children and objects are set whole,
  // in order.
  get masterCollection() { return x.main_collection_master(this.#context) >>> 0; }
  addCollection(parent, name) { return withString(name, (p) => x.main_collection_add(this.#context, parent ?? 0, p)) >>> 0; }
  removeCollection(collection) { x.main_collection_remove(this.#context, collection); }
  setCollectionChildren(collection, children) {
    withArrays([Uint32Array.from(children)], ([p]) => x.collection_children_set(this.#context, collection, p, children.length));
  }
  setCollectionObjects(collection, objects) {
    withArrays([Uint32Array.from(objects)], ([p]) => x.collection_objects_set(this.#context, collection, p, objects.length));
  }
  collectionChildren(collection) { return addresses((p) => x.collection_items(collection, false, p)); }
  collectionObjects(collection) { return addresses((p) => x.collection_items(collection, true, p)); }
  // Main as a .blend file, written by Blender's own writer (writefile.cc and each ID type's blend_write) through its
  // wm.save_as_mainfile operator, as a copy: the file's bytes. Image files live in the module only while the page runs,
  // so every image is packed into the file first, painted and generated ones as they are now (image-api.cc image_pack).
  writeBlend(filepath = '/untitled.blend') {
    for (const image of this.ids(ID_IM)) x.image_pack(this.bmain, image);
    x.main_save_preferences();
    const { status, report } = this.run('wm.save_as_mainfile', { filepath, copy: true, check_existing: false, relative_remap: false, compress: false });
    const bytes = files.get(filepath);
    files.delete(filepath);
    if (!(status & OPERATOR_FINISHED) || !bytes) throw new Error(report || 'Blender did not write the file');
    return bytes;
  }
  // Blender's undo stack (undo-api.cc): started from Main as it is, a step of Main's state pushed (returns it), and a
  // step loaded, undoing or redoing to it (false when the stack no longer holds it).
  undoInit() {
    x.undo_stack_init(this.#C);
    this.#undo = true;
  }
  // The active step, which the last push or load made (a sculpt stroke pushes its own).
  get undoStep() { return x.undo_active(this.#C) >>> 0; }
  undoPush(name) { return withString(name, (p) => x.undo_push(this.#C, p)) >>> 0; }
  undoLoad(step) {
    const loaded = x.undo_load(this.#C, step);
    x.main_context_refresh(this.#context);
    return loaded;
  }
  // A .blend opened as the Main, as Blender opens one (main_open): returns its warnings; throws when it cannot be read.
  // The undo stack starts again from the file, as reading one starts it (wm_file_read_post).
  readBlend(bytes) {
    // A gzip-compressed file (Blender before 3.0) unzipped here: the module has no zlib (main-api.cc BLI_filereader_new_gzip).
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = gunzipSync(bytes);
    const report = withArrays([Uint8Array.from(bytes)], ([p]) => x.main_open(this.#context, p, bytes.length)) >>> 0;
    if (this.#undo) this.undoInit();
    if (!report) throw new Error('Not a .blend file Blender can read');
    // A file without a screen is opened without its UI, which Bylonder never opens.
    return cString(report).split('\n').filter((line) => line && line !== 'Library file, loading empty scene');
  }

  // Main's IDs of a type (ID_GR, ID_OB...).
  ids(type) { return addresses((p) => x.main_ids(this.#context, type, p)); }
  name(id) { return cString(x.id_name(id)); }
  rename(id, name) { withString(name, (p) => x.id_rename(this.#context, id, p)); }
  // A collection's LayerCollection in the view layer, the active one (its collection), and activating one.
  layerCollection(collection) { return x.main_layer_collection(this.#context, collection) >>> 0; }
  get activeCollection() { return x.layer_collection_collection(x.main_layer_collection_active(this.#context)) >>> 0; }
  set activeCollection(collection) { x.main_layer_collection_activate(this.#context, this.layerCollection(collection)); }
  syncCollections() { x.main_collections_sync(this.#context); }
  // After Blender's code deleted objects: they leave the Scene Collection too, as they leave the scenes in Main.
  cleanMasterCollection() { x.main_collection_master_clean(this.#context); }
  // An object's base (eBaseFlags, with ACTIVE when it is the active one), or null when it has none in the view layer,
  // and its parent.
  base(ob) {
    const flag = x.main_base_get(this.#context, ob);
    return flag < 0 ? null : { flag, selected: !!(flag & BASE_SELECTED), hidden: !!(flag & BASE_HIDDEN), active: !!(flag & BASE_ACTIVE) };
  }
  parent(ob) { return x.object_parent(ob) >>> 0; }

  // Blender's operators that run without a modal session, by idname.
  operators() { return execOperators(); }
  run(idname, props = {}) { return runOperator(this.#C, idname, props); }
  // Invokes an operator with an event, as wmEvent takes it: its status, report and the values it ran with. One whose
  // invoke opened a popup ({ type, title, text }: windowmanager/wm-popups.js draws it) has not run; the popup's
  // choice runs it again by exec, but a properties dialog keeps the operator (`dialog`), whose properties it edits,
  // for finishPopup. One that runs modally is kept (`op`, with its modal `keymap`) for modal(). A menu it called (WM_menu_name_call) is a popup of its layout
  // when Blender has it, else `menu`, its name.
  invoke(idname, props, event) {
    const op = newOperator(idname, props);
    let kept = false;
    try {
      const status = x.operator_invoke(this.#C, op, wmEvent(this.#C, event)), type = POPUPS[x.operator_popup()];
      const result = { status, report: operatorReport(op), values: JSON.parse(cString(x.operator_values(op))) };
      if (type) result.popup = { type, title: cString(x.operator_popup_title()), text: cString(x.operator_popup_text()) };
      if (type === 'PROPS') result.dialog = op, kept = true;
      if (status & OPERATOR_RUNNING_MODAL && x.operator_modal_added(this.#C) >>> 0) Object.assign(result, { op, keymap: cString(x.operator_modal_keymap(op)) }), kept = true;
      // Blender's file browser handler holds it until the page's file dialog answers (wm-fileselect.js).
      if (status & OPERATOR_RUNNING_MODAL && !kept && x.fileselect_held(this.#C, op)) kept = true;
      const menu = cString(x.operator_menu_called());
      if (menu) {
        const popup = this.menu(menu);
        if (popup) result.popup = popup;
        else result.menu = menu;
      }
      return result;
    } finally {
      if (!kept) x.operator_free(op);
    }
  }
  poll(idname) { return pollOperator(this.#C, idname); }
  enumItems(idname, prop) { return operatorEnumItems(this.#C, idname, prop); }
  // Ends a properties dialog's operator (invoke's `op`): its exec when confirmed, as `run` reports it; then freed.
  finishPopup(op, confirmed) {
    try {
      if (!confirmed) return { status: OPERATOR_CANCELLED };
      return { status: x.operator_exec(this.#C, op), report: operatorReport(op), values: JSON.parse(cString(x.operator_values(op))) };
    } finally {
      x.operator_free(op);
    }
  }
  // Gives a running operator an event (`modal`: a modal keymap item's value): its status; it is freed once it ends.
  modal(op, event) {
    const status = x.operator_modal(this.#C, op, wmEvent(this.#C, event));
    if (!(status & OPERATOR_RUNNING_MODAL)) x.operator_free(op);
    return status;
  }
  // A modal keymap item's value for a running operator when its keymap lets it through now, else -1.
  modalItem(op, identifier) { return withString(identifier, (p) => x.operator_modal_item(op, p)); }
  // The 3D View Object Mode's operators act in (main_view_set), as regionView3D gives it.
  set view({ viewmat, winmat, winx, winy, persp, ofs = [0, 0, 0], dist = 0, cameraView = false }) {
    withArrays([Float32Array.from(viewmat), Float32Array.from(winmat), Float32Array.from(ofs)],
      ([v, w, o]) => x.main_view_set(this.#context, v, w, winx, winy, persp, o, dist, cameraView));
  }
  // Whether an operator left the view looking through the scene camera.
  get cameraView() { return x.main_view_persp(this.#context) === RV3D_CAMOB; }
  // What the last operator showed in the view's header, or ''.
  get status() { return cString(x.main_status(this.#context)); }
  // The context properties edited in a popup run in.
  get C() { return this.#C; }
  // A menu type (Blender's C's or its Python's), as a popup of its layout tree ({ type, title, text }: ui-tree.cc), or null.
  menu(name) {
    const text = withString(name, (p) => cString(x.ui_menu(this.#C, p)));
    return text ? { type: 'LAYOUT', title: withString(name, (p) => cString(x.menu_type_label(p))), text } : null;
  }
}

// The one Blender world every subsystem's data lives in (the module's Main); a realm makes it once.
let shared = null;
export const blenderMain = () => (shared ??= new BlenderMain());
// Runs fn on a Main apart from the scene's, for geometry Blender's operators make, its context the one operator
// properties are set in meanwhile.
let scratch;
export const inScratchMain = (fn) => (scratch ??= blenderMain().current(() => new BlenderMain())).current(fn);

// What subsystems with exports of their own (blenkernel/curve) reach the module through.
export const moduleAccess = { x, withArrays, withString, cString, extractedMesh, ownedMesh, runOperator, pollOperator, operatorEnumItems, operatorMenuProperty };
