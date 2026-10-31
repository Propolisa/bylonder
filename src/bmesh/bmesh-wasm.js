// Blender's own code (tools/blender-port/wasm, built by wasm_module.py): Main (BlenderMain) and its operators, and
// Mesh arrays extracted as Blender's draw cache extracts its buffers.
import { instantiate, files } from '../port/wasm.js';
import { createMesh } from '../blenkernel/mesh/mesh.js';
import { BMESH_WASM } from './bmesh-module.js';
import { moduleMesh } from './module-mesh.js';

const { exports: x } = await instantiate(BMESH_WASM);
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


// IDRecalcFlag: what the depsgraph evaluates again of an ID tagged with it (0 for all of it).
// The shapes an instance group draws (main-api.cc ParticleShape): an object's, what Blender's overlay expands a particle
// into, or a hair path's segment.
export const INSTANCE_SHAPES = ['OBJECT', 'DOT', 'CIRCLE', 'CROSS', 'AXIS', 'SEGMENT'];
export const ID_RECALC_TRANSFORM = 1 << 0, ID_RECALC_GEOMETRY = 1 << 1, ID_RECALC_SHADING = 1 << 7, ID_RECALC_SYNC_TO_EVAL = 1 << 13, ID_RECALC_ALL = 0xffffffff;
const OBJECT_TYPES = { EMPTY: 0, MESH: 1, CURVE: 2, FONT: 4, LIGHT: 10, CAMERA: 11, ARMATURE: 25 };
const ROTATION_MODES = ['QUATERNION', 'XYZ', 'XZY', 'YXZ', 'YZX', 'ZXY', 'ZYX'];
// A Mesh attribute's AttrDomain, and its AttrType with the array of its values and their number per element.
const DOMAINS = { POINT: 0, EDGE: 1, FACE: 2, CORNER: 3 };
// eBaseFlags, and the bit main_base_get adds for the active base.
const BASE_SELECTED = 1 << 0, BASE_HIDDEN = 1 << 8, BASE_ACTIVE = 1 << 30;
// The addresses an export writes when given an array, after it counted them without one.
const addresses = (fn) => {
  const count = fn(0);
  return withArrays([new Uint32Array(count)], ([p]) => { fn(p); return Array.from(new Uint32Array(x.memory.buffer, p, count)); });
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
export class BlenderMain {
  #context = x.main_new();
  #C = x.main_C(this.#context);
  #undo = false;

  constructor() { x.rna_context_set(this.#C); }

  // An object of a type (EMPTY, MESH, CURVE, FONT, LIGHT, CAMERA) with new data of its type.
  add(type, name) { return withString(name, (p) => x.main_object_add(this.#context, OBJECT_TYPES[type], p)) >>> 0; }
  remove(ob) { x.main_object_remove(this.#context, ob); }

  // Its base in the view layer: whether its collection shows it, whether it is hidden, unselectable, selected or active.
  setBase(ob, { visible = true, hidden = false, hide_select = false, select = false, active = false }) {
    x.main_base_set(this.#context, ob, visible, hidden, hide_select, select, active);
  }
  setParent(ob, parent) { x.object_parent_set(ob, parent ?? 0); }
  setMode(ob, mode) { x.object_mode_set(ob, mode === 'EDIT' ? 1 : 0); }

  // The object's DNA (ObjectFields in main-api.cc), read and written in place.
  #fields(ob) {
    const [location, euler, quaternion, scale, mode, parentinv, world, recalc, dataRecalc] = new Uint32Array(x.memory.buffer, x.object_fields(ob) >>> 0, 9);
    const floats = (p, n) => new Float32Array(x.memory.buffer, p, n);
    return { location: floats(location, 3), rotation_euler: floats(euler, 3), rotation_quaternion: floats(quaternion, 4), scale: floats(scale, 3),
      rotation_mode: new Int16Array(x.memory.buffer, mode, 1), matrix_parent_inverse: floats(parentinv, 16), matrix_world: floats(world, 16),
      recalc: new Uint32Array(x.memory.buffer, recalc, 1), dataRecalc: dataRecalc && new Uint32Array(x.memory.buffer, dataRecalc, 1) };
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

  // Main evaluated by Blender's depsgraph for what was tagged; clears the tags.
  evaluate() { x.main_evaluate(this.#context); }
  // The scene at a frame, evaluated by its depsgraph (animation, drivers and what depends on them).
  set frame(frame) { x.view_frame_set(this.#C, frame); }
  // What Main's objects draw as instances (main-api.cc main_instances): groups of one shape, { instancer, ob (the
  // object instanced, or 0 for a particle shape), shape (INSTANCE_SHAPES), overlay (drawn in the viewport only), color
  // (the shape's), matrices (world matrices in Babylon's layout), colors (each instance's RGBA, or null) }, the arrays
  // views into the module's memory valid until the next call.
  instances() {
    const count = x.main_instances(this.#context), at = x.main_instance_groups() >>> 0, ints = new Int32Array(x.memory.buffer, at, count * 10);
    const floats = new Float32Array(x.memory.buffer, at, count * 10), matrices = x.main_instance_matrices() >>> 0, colors = x.main_instance_colors() >>> 0;
    return Array.from({ length: count }, (_, i) => {
      const [instancer, ob, shape, overlay, first, n, colored] = ints.subarray(i * 10, i * 10 + 7);
      return { instancer: instancer >>> 0, ob: ob >>> 0, shape: INSTANCE_SHAPES[shape], overlay: !!overlay, color: Array.from(floats.subarray(i * 10 + 7, i * 10 + 10)),
        matrices: new Float32Array(x.memory.buffer, matrices + first * 64, n * 16), colors: colored ? new Float32Array(x.memory.buffer, colors + first * 16, n * 4) : null };
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
      return [OWN_NAMES.get(name) ?? name, { domain, type, data: new Type(x.memory.buffer, pointer, mesh[DOMAIN_SIZES[domain]] * size) }];
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
    if (slots) mesh.attributes.set('material_index', { domain: 'FACE', type: 'INT', get data() { return new Int32Array(x.memory.buffer, slots, mesh.faces_num); } });
    return mesh;
  }
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
  // Changes an object's rotation mode (eRotationModes), keeping its rotation.
  setRotationMode(ob, mode) { x.object_rotation_mode_set(ob, mode); }

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

  // The Main's address and an object's data's address (0 for an empty), for subsystems with their own exports.
  get bmain() { return x.main_bmain(this.#context) >>> 0; }
  get scene() { return x.main_scene(this.#context) >>> 0; }
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
  // wm.save_as_mainfile operator, as a copy: the file's bytes.
  writeBlend(filepath = '/untitled.blend') {
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
  undoPush(name) { return withString(name, (p) => x.undo_push(this.#C, p)) >>> 0; }
  undoLoad(step) {
    const loaded = x.undo_load(this.#C, step);
    x.main_context_refresh(this.#context);
    return loaded;
  }
  // A .blend opened as the Main, as Blender opens one (main_open): returns its warnings; throws when it cannot be read.
  // The undo stack starts again from the file, as reading one starts it (wm_file_read_post).
  readBlend(bytes) {
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
  set view({ viewmat, winmat, winx, winy, persp }) {
    withArrays([Float32Array.from(viewmat), Float32Array.from(winmat)], ([v, w]) => x.main_view_set(this.#context, v, w, winx, winy, persp));
  }
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
export function inScratchMain(fn) {
  scratch ??= new BlenderMain();
  x.rna_context_set(scratch.C);
  try {
    return fn(scratch);
  } finally {
    x.rna_context_set(blenderMain().C);
  }
}

// What subsystems with exports of their own (blenkernel/curve) reach the module through.
export const moduleAccess = { x, withArrays, withString, cString, extractedMesh, ownedMesh, runOperator, pollOperator, operatorEnumItems, operatorMenuProperty };
