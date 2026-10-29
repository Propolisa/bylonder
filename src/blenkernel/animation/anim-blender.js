// Blender's animation data in the module's Blender world (anim-api.cc): AnimData, layered Actions and F-Curves on the
// IDs of a BlenderMain, read and written in place as Blender's DNA (FCurve, BezTriple), and evaluated by Blender's
// evaluate_fcurve. Animation editors' areas (AnimArea) live here too: see editors/animation/anim-area.js.
import { blenderModule, enumTable } from '../../bmesh/bmesh-wasm.js';
import rnaAnimated from '../../makesrna/rna-animated.json' with { type: 'json' };

const { exports: x, withArrays, withString, cString } = blenderModule;

export { EVENT_TYPES, EVENT_VALUES } from '../../bmesh/bmesh-wasm.js';
export const PROPERTY_SUBTYPES = enumTable(2);
export const PROPERTY_TYPES = { BOOLEAN: 0, INT: 1, FLOAT: 2, STRING: 3, ENUM: 4, POINTER: 5, COLLECTION: 6 };
export const animatedProperty = (struct, identifier) => rnaAnimated[struct]?.properties[identifier];

// Custom properties (ID properties, `["name"]` paths), which Babylon-native data is animated through: a number, a
// boolean or an array of numbers on any ID, with an RNA subtype (COLOR) and a description (anim_id_property_set).
// A name is at most 63 characters, as Blender's are: a longer one keeps its start and a hash of the whole.
const MAX_NAME = 63;
export function customPropertyName(name) {
  if (name.length <= MAX_NAME) return name;
  let hash = 0;
  for (const c of name) hash = (Math.imul(hash, 31) + c.codePointAt(0)) >>> 0;
  return name.slice(0, MAX_NAME - 9) + '~' + hash.toString(16).padStart(8, '0');
}
export const customPropertyPath = (name) => `["${name.replace(/["\\]/g, (c) => '\\' + c)}"]`;
export function setCustomProperty(id, name, value, { subtype = 'NONE', description = '' } = {}) {
  const values = [value].flat(), type = typeof values[0] === 'boolean' ? 'BOOLEAN' : 'FLOAT';
  withArrays([Float64Array.from(values, Number)], ([v]) => withString(name, (n) => withString(description, (d) =>
    x.anim_id_property_set(id, n, PROPERTY_TYPES[type], v, Array.isArray(value) ? values.length : 0, PROPERTY_SUBTYPES.get(subtype) ?? 0, d))));
}
// A custom property's value (a number, or an array of them), or undefined when the ID has no number property of that name.
export function customProperty(id, name, capacity = 16) {
  return withArrays([new Float64Array(capacity)], ([p]) => {
    const count = withString(name, (n) => x.anim_id_property_get(id, n, p, capacity));
    if (count < 0) return undefined;
    const values = Array.from(new Float64Array(x.memory.buffer, p, Math.max(count, 1)));
    return count ? values : values[0];
  });
}

// FCurve and BezTriple field offsets (anim_layout).
const L = Array.from(new Int32Array(x.memory.buffer, x.anim_layout() >>> 0, 24));
const [, FC_BEZT, FC_TOTVERT, FC_FLAG, FC_RNA_PATH, FC_ARRAY_INDEX, FC_COLOR, FC_EXTEND, FC_COLOR_MODE, FC_AUTO_SMOOTHING,
  BEZT_SIZE, B_VEC, B_IPO, B_H1, B_H2, B_F1, B_F2, B_F3, B_EASING, B_BACK, B_AMPLITUDE, B_PERIOD, , B_HIDE] = L;

// Blender's enum identifiers for BezTriple's and FCurve's values (rna_curve.cc, rna_fcurve.cc), in value order.
import { INTERPOLATIONS, HANDLE_TYPES, EASINGS, KEYFRAME_TYPES, EXTRAPOLATIONS } from './saved.js';
export { INTERPOLATIONS, HANDLE_TYPES, EASINGS, KEYFRAME_TYPES, EXTRAPOLATIONS };
export const COLOR_MODES = ['AUTO_RAINBOW', 'AUTO_RGB', 'CUSTOM', 'AUTO_YRGB'];
export const SMOOTHINGS = ['NONE', 'CONT_ACCEL'];
const SELECT = 1;
// eFCurve_Flags.
export const CREATEDRIVER_WITH_DEFAULT_DVAR = 1 << 0;
export const FCURVE = { VISIBLE: 1 << 0, SELECTED: 1 << 1, ACTIVE: 1 << 2, PROTECTED: 1 << 3, MUTED: 1 << 4, DISABLED: 1 << 10 };

const view = () => new DataView(x.memory.buffer);
const pointerList = (count, fill) => {
  if (!count) return [];
  return withArrays([new Uint32Array(count)], ([p]) => { fill(p); return Array.from(new Uint32Array(x.memory.buffer, p, count)); });
};

// A BezTriple's fields as Blender's RNA names them (Keyframe), values in the F-Curve's own units.
function readKey(dv, p) {
  const f = (i) => dv.getFloat32(p + B_VEC + i * 4, true);
  return {
    co: [f(3), f(4)], handle_left: [f(0), f(1)], handle_right: [f(6), f(7)],
    interpolation: INTERPOLATIONS[dv.getInt8(p + B_IPO)], handle_left_type: HANDLE_TYPES[dv.getUint8(p + B_H1)],
    handle_right_type: HANDLE_TYPES[dv.getUint8(p + B_H2)], easing: EASINGS[dv.getInt8(p + B_EASING)],
    type: KEYFRAME_TYPES[dv.getInt8(p + B_HIDE)], back: dv.getFloat32(p + B_BACK, true), amplitude: dv.getFloat32(p + B_AMPLITUDE, true),
    period: dv.getFloat32(p + B_PERIOD, true),
    select: [B_F1, B_F2, B_F3].map((o) => !!(dv.getUint8(p + o) & SELECT)),
  };
}

function writeKey(dv, p, key) {
  const set = (i, v) => dv.setFloat32(p + B_VEC + i * 4, v, true);
  const [left, co, right] = [key.handle_left ?? key.co, key.co, key.handle_right ?? key.co];
  [left, co, right].forEach(([fx, fy], i) => { set(i * 3, fx); set(i * 3 + 1, fy); set(i * 3 + 2, 0); });
  dv.setInt8(p + B_IPO, Math.max(0, INTERPOLATIONS.indexOf(key.interpolation ?? 'BEZIER')));
  dv.setUint8(p + B_H1, Math.max(0, HANDLE_TYPES.indexOf(key.handle_left_type ?? 'AUTO_CLAMPED')));
  dv.setUint8(p + B_H2, Math.max(0, HANDLE_TYPES.indexOf(key.handle_right_type ?? 'AUTO_CLAMPED')));
  dv.setInt8(p + B_EASING, Math.max(0, EASINGS.indexOf(key.easing ?? 'AUTO')));
  dv.setInt8(p + B_HIDE, Math.max(0, KEYFRAME_TYPES.indexOf(key.type ?? 'KEYFRAME')));
  dv.setFloat32(p + B_BACK, key.back ?? 1.70158, true);
  dv.setFloat32(p + B_AMPLITUDE, key.amplitude ?? 0.8, true);
  dv.setFloat32(p + B_PERIOD, key.period ?? 4.1, true);
  const select = key.select ?? [false, false, false];
  [B_F1, B_F2, B_F3].forEach((o, i) => dv.setUint8(p + o, select[i] ? SELECT : 0));
}

// One F-Curve, by its address.
export class FCurve {
  constructor(pointer) { this.pointer = pointer; }
  get #dv() { return view(); }
  get rna_path() { return cString(this.#dv.getUint32(this.pointer + FC_RNA_PATH, true)); }
  get array_index() { return this.#dv.getInt32(this.pointer + FC_ARRAY_INDEX, true); }
  get group() { return cString(x.anim_fcurve_group(this.pointer)); }
  get flag() { return this.#dv.getInt16(this.pointer + FC_FLAG, true); }
  set flag(value) { this.#dv.setInt16(this.pointer + FC_FLAG, value, true); }
  get color() { return [0, 1, 2].map((i) => this.#dv.getFloat32(this.pointer + FC_COLOR + i * 4, true)); }
  set color(value) { value.forEach((v, i) => this.#dv.setFloat32(this.pointer + FC_COLOR + i * 4, v, true)); }
  get color_mode() { return COLOR_MODES[this.#dv.getInt32(this.pointer + FC_COLOR_MODE, true)]; }
  set color_mode(value) { this.#dv.setInt32(this.pointer + FC_COLOR_MODE, COLOR_MODES.indexOf(value), true); }
  get auto_smoothing() { return SMOOTHINGS[this.#dv.getInt8(this.pointer + FC_AUTO_SMOOTHING)]; }
  // Its auto handles recalculated, as RNA's update does.
  set auto_smoothing(value) { this.#dv.setInt8(this.pointer + FC_AUTO_SMOOTHING, SMOOTHINGS.indexOf(value)); this.keys = this.keys; }
  // The key Blender's panels edit (the active keyframe), or -1.
  get active_key() { return x.anim_fcurve_active_key(this.pointer); }
  get extrapolation() { return EXTRAPOLATIONS[this.#dv.getInt8(this.pointer + FC_EXTEND)]; }
  set extrapolation(value) { this.#dv.setInt8(this.pointer + FC_EXTEND, EXTRAPOLATIONS.indexOf(value)); }
  get length() { return this.#dv.getInt32(this.pointer + FC_TOTVERT, true); }
  get #bezt() { return this.#dv.getUint32(this.pointer + FC_BEZT, true); }
  // Its keyframe points (Keyframe), copied out.
  get keys() {
    const dv = this.#dv, bezt = this.#bezt;
    return Array.from({ length: this.length }, (_, i) => readKey(dv, bezt + i * BEZT_SIZE));
  }
  // Replaces its keys, sorted and with handles recalculated as after an edit.
  set keys(keys) {
    const bytes = new Uint8Array(keys.length * BEZT_SIZE), dv = new DataView(bytes.buffer);
    keys.forEach((key, i) => writeKey(dv, i * BEZT_SIZE, key));
    withArrays([bytes], ([p]) => x.anim_fcurve_keys_set(this.pointer, p, keys.length));
  }
  set active_key(index) { x.anim_fcurve_active_key_set(this.pointer, index); }
  evaluate(frame) { return x.anim_fcurve_evaluate(this.pointer, frame); }
  // Values at count frames from start, step apart.
  sample(start, step, count) {
    return withArrays([new Float32Array(count)], ([p]) => { x.anim_fcurve_sample(this.pointer, start, step, count, p); return Float32Array.from(new Float32Array(x.memory.buffer, p, count)); });
  }
}

// One Action (bAction), by its address: what the Dope Sheet's Action panels show of it.
const [ACT_FLAG, ACT_FRAME_START, ACT_FRAME_END, ACT_NAME] = Array.from(new Int32Array(x.memory.buffer, x.anim_action_layout() >>> 0, 4));
const ACT_FRAME_RANGE = 1 << 12, ACT_CYCLIC = 1 << 13;
export class Action {
  constructor(pointer) { this.pointer = pointer; }
  get #dv() { return view(); }
  get name() { return cString(this.pointer + ACT_NAME + 2); }
  get flag() { return this.#dv.getInt32(this.pointer + ACT_FLAG, true); }
  set flag(value) { this.#dv.setInt32(this.pointer + ACT_FLAG, value, true); }
  get use_frame_range() { return !!(this.flag & ACT_FRAME_RANGE); }
  set use_frame_range(value) { x.anim_action_use_frame_range_set(this.pointer, !!value); }
  get use_cyclic() { return !!(this.flag & ACT_CYCLIC); }
  set use_cyclic(value) { this.flag = value ? this.flag | ACT_CYCLIC : this.flag & ~ACT_CYCLIC; }
  get frame_start() { return this.#dv.getFloat32(this.pointer + ACT_FRAME_START, true); }
  // As rna_action.cc's setters: the other end follows so the range stays ordered.
  set frame_start(value) {
    this.#dv.setFloat32(this.pointer + ACT_FRAME_START, value, true);
    if (this.frame_end < value) this.#dv.setFloat32(this.pointer + ACT_FRAME_END, value, true);
  }
  get frame_end() { return this.#dv.getFloat32(this.pointer + ACT_FRAME_END, true); }
  set frame_end(value) {
    this.#dv.setFloat32(this.pointer + ACT_FRAME_END, value, true);
    if (this.frame_start > value) this.#dv.setFloat32(this.pointer + ACT_FRAME_START, value, true);
  }
  // Its active slot: the display name and the target ID type's icon, or null.
  get activeSlot() {
    return withArrays([new Int32Array(1)], ([icon]) => {
      const name = x.anim_action_slot(this.pointer, icon) >>> 0;
      return name ? { name_display: cString(name), icon: new Int32Array(x.memory.buffer, icon, 1)[0] } : null;
    });
  }
}

// eInsertKeyFlags: none, as keying with Blender's default Preferences inserts.
export const INSERTKEY_NOFLAGS = 0;

// The animation of a BlenderMain's IDs (an object's address, or the scene's).
export class BlenderAnimation {
  constructor(main) {
    this.main = main;
  }
  // The F-Curve of an ID's property, made as keying makes it when missing (a channel group, PropertyType and subtype
  // decide its flags and color).
  fcurve(id, rnaPath, index, { group = '', type = 'FLOAT', subtype = 'NONE' } = {}) {
    return new FCurve(withString(rnaPath, (p) => withString(group, (g) =>
      x.anim_fcurve_ensure(this.main.bmain, id, p, index, g, PROPERTY_TYPES[type], PROPERTY_SUBTYPES.get(subtype) ?? 0))) >>> 0);
  }
  fcurves(id) { return pointerList(x.anim_fcurves(id, 0), (p) => x.anim_fcurves(id, p)).map((p) => new FCurve(p)); }
  // An ID's drivers (AnimData.drivers), and a driver added on one of its properties (anim_driver_add; flag:
  // CREATEDRIVER_WITH_DEFAULT_DVAR as the Add Driver button, 0 as Python's driver_add), or null.
  drivers(id) { return pointerList(x.anim_drivers(id, 0), (p) => x.anim_drivers(id, p)).map((p) => new FCurve(p)); }
  addDriver(id, rnaPath, index, flag = CREATEDRIVER_WITH_DEFAULT_DVAR) {
    const pointer = withString(rnaPath, (p) => x.anim_driver_add(id, p, index, flag)) >>> 0;
    return pointer ? new FCurve(pointer) : null;
  }
  remove(id, fcurve) { x.anim_fcurve_remove(id, fcurve.pointer); }
  // Inserts a key as Blender's keying does.
  insert(fcurve, frame, value, flags = INSERTKEY_NOFLAGS) { return x.anim_keyframe_insert(this.main.scene, fcurve.pointer, frame, value, flags); }
  // Keys an ID's RNA path at the scene's frame with its value now, as keyframe_insert() does (every element of an array
  // for index -1), into a channel group (Blender's default for an empty one): the keys inserted. keyDelete and
  // keyClear remove the key at the frame and the whole F-Curves, as keyframe_delete() and Clear Keyframes do.
  keyInsert(id, path, index = -1, group = '') { return withString(path, (p) => withString(group, (g) => x.anim_path_keyframe_insert(this.main.C, id, p, index, g))); }
  keyDelete(id, path, index = -1) { return withString(path, (p) => x.anim_path_keyframe_delete(this.main.C, id, p, index)); }
  keyClear(id, path, index = -1) { return withString(path, (p) => x.anim_path_keyframe_clear(this.main.C, id, p, index)); }
  // The scene's time and keying settings the editors read.
  setTime({ frame, start, end, previewStart, previewEnd, preview, fps, keyframeType = 'KEYFRAME', autoKey = false }) {
    const cfra = Math.floor(frame);
    x.anim_scene_time_set(this.main.scene, cfra, frame - cfra, start, end, previewStart, previewEnd, preview, fps, KEYFRAME_TYPES.indexOf(keyframeType), autoKey);
  }
  // The scene's markers (Scene.timeline_markers): { name, frame, select } in list order; set replaces them.
  get markers() {
    return Array.from({ length: x.anim_markers(this.main.scene) }, (_, i) => withArrays([new Int32Array(2)], ([p]) => {
      const name = cString(x.anim_marker(this.main.scene, i, p)), [frame, flag] = new Int32Array(x.memory.buffer, p, 2);
      return { name, frame, select: !!(flag & SELECT) };
    }));
  }
  set markers(markers) {
    x.anim_markers_clear(this.main.scene);
    for (const { name, frame, select } of markers) withString(name, (n) => x.anim_marker_add(this.main.scene, frame, select ? SELECT : 0, n));
  }
  get frame() { return x.anim_scene_frame(this.main.scene); }
  get range() {
    const [start, end, previewStart, previewEnd, preview] = new Int32Array(x.memory.buffer, x.anim_scene_range(this.main.scene) >>> 0, 5);
    return { start, end, previewStart, previewEnd, preview: !!preview };
  }
}
