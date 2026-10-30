// Blender's Curve and Text data (DNA_curve_types.h), held by Bylonder as Curve data in RNA's terms and evaluated by
// Blender's own code in the module's Main (tools/blender-port/wasm/curve-api.cc). The data is
//   { type: 'CURVE' | 'FONT', settings: { Curve and TextCurve properties by RNA identifier },
//     splines: [{ type, flag, flagu, flagv, order_u, order_v, resolution_u, resolution_v, point_count_u, point_count_v,
//       material_index, hide, character_index, tilt_interpolation, radius_interpolation, points | bezier_points }],
//     active: [spline, point], text: { body, format: [[flag, material_index, kerning]], pos, selstart, selend,
//       boxes: [[x, y, width, height]], actbox, fonts: [regular, bold, italic, bold italic] (font names, null for the
//       built-in font) }, targets: { follow_curve, bevel_object, taper_object } (object names) }
// with the point fields of BezierSplinePoint and SplinePoint (co, handle_left, handle_right, handle_left_type, ...).
// Settings are written at their DNA offsets (dna-curves.json, from rna_curve.cc) as RNA's setters would.
import rna from '../../makesrna/rna-curves.json' with { type: 'json' };
import dna from '../../makesrna/dna-curves.json' with { type: 'json' };
import { blenderMain, moduleAccess, newOperator, ID_RECALC_GEOMETRY } from '../../bmesh/bmesh-wasm.js';
import { EVENT_TYPES, EVENT_VALUES } from '../animation/anim-blender.js';
import { blenderModifierDefinition, modifierPointers } from '../../modifiers/blender.js';

const { x, withArrays, withString, cString, ownedMesh, runOperator, pollOperator, operatorEnumItems } = moduleAccess;

const CU_BEZIER = 1, CU_NURBS = 4;
const SPLINE_TYPES = Object.fromEntries(rna.Spline.properties.type.items.map(([id, , , value]) => [value, id]));
const HANDLE_TYPES = Object.fromEntries(rna.BezierSplinePoint.properties.handle_left_type.items.map(([id, , , value]) => [value, id]));
const value = (items, id) => items.find((item) => item[0] === id)[3];
const SELECT = 1;
// Curve.flag bits behind enum properties RNA stores as flags: dimensions (CU_3D) and fill_mode (CU_FRONT, CU_BACK).
const CU_3D = 1, CU_FRONT = 2, CU_BACK = 4;
const FILL = { NONE: 0, FULL: 0, BACK: CU_BACK, FRONT: CU_FRONT, BOTH: CU_FRONT | CU_BACK, HALF: CU_FRONT | CU_BACK };
const NURB_INTS = 15, BEZT_INTS = 6, BEZT_FLOATS = 12, BP_INTS = 2, BP_FLOATS = 7;
// Pointer properties naming other objects, which the data holds by name.
export const CURVE_TARGETS = ['follow_curve', 'bevel_object', 'taper_object'];

// The splines' points as curve-api.cc lays them out (curve_nurbs_set).
function splineArrays(splines) {
  const ints = [], floats = [];
  for (const s of splines) {
    const bezier = s.type === 'BEZIER', points = bezier ? s.bezier_points : s.points;
    ints.push(value(rna.Spline.properties.type.items, s.type), s.flag ?? 0, bezier ? points.length : points.length / Math.max(1, s.point_count_v ?? 1), s.point_count_v ?? (bezier ? 0 : 1),
      s.order_u ?? 4, s.order_v ?? 4, s.resolution_u ?? 12, s.resolution_v ?? 12, s.flagu ?? 0, s.flagv ?? 0, s.material_index ?? 0,
      s.hide ? 1 : 0, s.character_index ?? 0, s.tilt_interpolation ?? 0, s.radius_interpolation ?? 0);
    for (const p of points) {
      if (bezier) {
        ints.push(value(rna.BezierSplinePoint.properties.handle_left_type.items, p.handle_left_type),
          value(rna.BezierSplinePoint.properties.handle_right_type.items, p.handle_right_type),
          p.select_left_handle ? SELECT : 0, p.select_control_point ? SELECT : 0, p.select_right_handle ? SELECT : 0, p.hide ? 1 : 0);
        floats.push(...p.handle_left, ...p.co, ...p.handle_right, p.tilt ?? 0, p.weight_softbody ?? 0.01, p.radius ?? 1);
      } else {
        ints.push(p.select ? SELECT : 0, p.hide ? 1 : 0);
        floats.push(...p.co, p.tilt ?? 0, p.weight_softbody ?? 0.01, p.radius ?? 1);
      }
    }
  }
  return { ints: Int32Array.from(ints), floats: Float32Array.from(floats) };
}

// The splines of curve_nurbs_get's header.
function readSplines(header) {
  const [nurbs_num, ints_num, floats_num, intsAt, floatsAt, actnu, actvert] = new Int32Array(x.memory.buffer, header, 7);
  const ints = new Int32Array(x.memory.buffer, intsAt >>> 0, ints_num), floats = new Float32Array(x.memory.buffer, floatsAt >>> 0, floats_num);
  let i = 0, f = 0;
  const round = (n) => Array.from(floats.subarray(f, (f += n)));
  const splines = Array.from({ length: nurbs_num }, () => {
    const [type, flag, pntsu, pntsv, order_u, order_v, resolution_u, resolution_v, flagu, flagv, material_index, hide, character_index,
      tilt_interpolation, radius_interpolation] = ints.subarray(i, (i += NURB_INTS));
    const spline = { type: SPLINE_TYPES[type], flag, flagu, flagv, order_u, order_v, resolution_u, resolution_v, point_count_u: pntsu,
      point_count_v: pntsv, material_index, hide: !!hide, character_index, tilt_interpolation, radius_interpolation };
    if (type === CU_BEZIER) {
      spline.bezier_points = Array.from({ length: pntsu }, () => {
        const [h1, h2, f1, f2, f3, phide] = ints.subarray(i, (i += BEZT_INTS));
        const [handle_left, co, handle_right] = [round(3), round(3), round(3)], [tilt, weight_softbody, radius] = round(3);
        return { co, handle_left, handle_right, handle_left_type: HANDLE_TYPES[h1], handle_right_type: HANDLE_TYPES[h2],
          select_left_handle: !!(f1 & SELECT), select_control_point: !!(f2 & SELECT), select_right_handle: !!(f3 & SELECT), hide: !!phide,
          tilt, weight_softbody, radius };
      });
    } else {
      spline.points = Array.from({ length: pntsu * pntsv }, () => {
        const [f1, phide] = ints.subarray(i, (i += BP_INTS)), co = round(4), [tilt, weight_softbody, radius] = round(3);
        return { co, select: !!(f1 & SELECT), hide: !!phide, tilt, weight_softbody, radius };
      });
    }
    return spline;
  });
  return { splines, active: [actnu, actvert] };
}

// RNA's view of a spline's DNA flags.
export const splineFlags = {
  use_cyclic_u: [1, 'flagu'], use_endpoint_u: [2, 'flagu'], use_bezier_u: [4, 'flagu'],
  use_cyclic_v: [1, 'flagv'], use_endpoint_v: [2, 'flagv'], use_bezier_v: [4, 'flagv'], use_smooth: [1, 'flag'],
};

// Where a setting is stored: the Curve's own properties, then TextCurve's.
const located = (name) => dna.Curve.properties[name] ?? dna.TextCurve.properties[name];
const property = (name) => rna.Curve.properties[name] ?? rna.TextCurve.properties[name];
const GET = { 1: ['Int8', 'Uint8'], 2: ['Int16', 'Uint16'], 4: ['Int32', 'Uint32'] };

// Writes a setting as RNA's setter stores it: offset as Curve.offset minus one (rna_Curve_offset_set), dimensions and
// fill_mode as flags, enums by their items' values, booleans as bits.
function writeSetting(view, address, name, v) {
  const field = located(name), prop = property(name);
  if (!field || !prop || field.kind === 'pointer' || field.kind === 'struct' || field.length) return false;
  const at = address + field.offset, [signed, unsigned] = GET[field.size];
  const type = field.signed ? signed : unsigned;
  if (name === 'offset') { view.setFloat32(at, v + 1, true); return true; }
  if (field.kind === 'float') { view.setFloat32(at, v, true); return true; }
  const word = view[`get${type}`](at, true);
  if (name === 'dimensions') view[`set${type}`](at, v === '3D' ? word | CU_3D : word & ~CU_3D, true);
  else if (name === 'fill_mode') view[`set${type}`](at, (word & ~(CU_FRONT | CU_BACK)) | FILL[v], true);
  else if (field.bit !== undefined) view[`set${type}`](at, !!v !== !!field.negative ? word | field.bit : word & ~field.bit, true);
  else view[`set${type}`](at, prop.type === 'ENUM' ? value(prop.items, v) : Number(v), true);
  return true;
}

function readSetting(view, address, name) {
  const field = located(name), prop = property(name);
  if (!field || !prop || field.kind === 'pointer' || field.kind === 'struct' || field.length) return undefined;
  const at = address + field.offset, [signed, unsigned] = GET[field.size];
  if (name === 'offset') return view.getFloat32(at, true) - 1;
  if (field.kind === 'float') return view.getFloat32(at, true);
  const word = view[`get${field.signed ? signed : unsigned}`](at, true);
  if (name === 'dimensions') return word & CU_3D ? '3D' : '2D';
  if (name === 'fill_mode') {
    const ids = word & CU_3D ? ['FULL', 'BACK', 'FRONT', 'HALF'] : ['NONE', 'BACK', 'FRONT', 'BOTH'];
    return ids.find((id) => FILL[id] === (word & (CU_FRONT | CU_BACK)));
  }
  if (field.bit !== undefined) return !!(word & field.bit) !== !!field.negative;
  return prop.type === 'ENUM' ? prop.items.find((item) => item[3] === word)?.[0] : word;
}

// The settings a Curve of a type stores (its properties with DNA fields of their own).
export const settingNames = (type) => Object.keys({ ...rna.Curve.properties, ...(type === 'FONT' ? rna.TextCurve.properties : {}) })
  .filter((name) => { const field = located(name); return field && !['pointer', 'struct'].includes(field.kind) && !field.length; });

// Fonts by name in the module's Main: the built-in font (null) and fonts loaded from their files' bytes.
const fonts = new Map();
const font = (name) => (name ? fonts.get(name) ?? 0 : x.curve_vfont_builtin() >>> 0);
// Loads a TrueType, OpenType or Type 1 font file's bytes; returns its name, or null when FreeType cannot read it.
export function loadFont(name, bytes) {
  blenderMain();
  const vfont = withString(name, (path) => withArrays([new Uint8Array(bytes)], ([data]) => x.curve_vfont_new(blenderMain().bmain, data, bytes.byteLength, path))) >>> 0;
  if (!vfont) return null;
  fonts.set(name, vfont);
  return name;
}
export const fontNames = () => [...fonts.keys()];

const CHARINFO_SIZE = 8;

// A curve or text object in the module's Main, holding its Curve data while Bylonder edits or evaluates it.
export class CurveObject {
  // A new object in a Main (BlenderMain, by default the realm's), or `ob`, one of its objects of that type (Object
  // Mode's mirror of a node).
  constructor(type, name = type === 'FONT' ? 'Text' : 'Curve', ob = null, main = blenderMain()) {
    this.main = main;
    this.type = type;
    this.ob = ob ?? this.main.add(type, name);
    // The names of the objects its pointers name (follow_curve, bevel_object, taper_object); target() points them.
    this.targets = {};
  }

  free() { this.main.remove(this.ob); }
  get #curve() { return this.main.data(this.ob); }

  // Its Curve data as Bylonder holds it (the edit data in Edit Mode).
  get data() {
    const view = new DataView(x.memory.buffer), curve = this.#curve;
    const settings = Object.fromEntries(settingNames(this.type).map((name) => [name, readSetting(view, curve, name)]));
    const data = { type: this.type, settings, ...readSplines(x.curve_nurbs_get(this.ob) >>> 0), targets: { ...this.#pointed(view, curve), ...this.targets } };
    if (this.type === 'FONT') data.text = this.text;
    return data;
  }

  // Sets its Curve data (settings missing from it keep Blender's defaults); targets map object names to objects.
  set data({ settings = {}, splines, active = [0, 0], text, targets = {} }) {
    this.targets = targets;
    this.settings = settings;
    if (splines) this.splines = { splines, active };
    if (text) this.text = text;
  }

  // The objects its pointers name in Main, by name.
  #pointed(view, curve) {
    return Object.fromEntries(CURVE_TARGETS.map((name) => [name, view.getUint32(curve + located(name).offset, true)]).filter(([, ob]) => ob)
      .map(([name, ob]) => [name, this.main.name(ob)]));
  }

  set settings(settings) {
    const view = new DataView(x.memory.buffer), curve = this.#curve;
    for (const [name, v] of Object.entries(settings)) writeSetting(view, curve, name, v);
    if ('bevel_mode' in settings || 'bevel_resolution' in settings) x.curve_bevel_profile_update(this.ob);
    this.main.tag(curve, ID_RECALC_GEOMETRY);
  }

  set splines({ splines, active = [0, 0] }) {
    const { ints, floats } = splineArrays(splines);
    withArrays([ints, floats], ([i, f]) => x.curve_nurbs_set(this.ob, splines.length, i, f, active[0], active[1]));
  }

  // The text and its formats, cursor, selection and boxes, and in Edit Mode where the layout puts the cursor
  // (four corners) and the selection boxes ({x, y, w, h, rotate}).
  get text() {
    const [body, len, infoAt, pos, selstart, selend, cursAt, boxesAt, boxesLen, tbAt, totbox, actbox] =
      new Int32Array(x.memory.buffer, x.curve_text_get(this.ob) >>> 0, 12);
    const view = new DataView(x.memory.buffer);
    const format = Array.from({ length: len }, (_, i) => {
      const at = (infoAt >>> 0) + i * CHARINFO_SIZE;
      return [view.getUint8(at + 6), view.getInt16(at + 4, true), view.getFloat32(at, true)];
    });
    const boxes = Array.from({ length: totbox }, (_, i) => Array.from(new Float32Array(x.memory.buffer, (tbAt >>> 0) + i * 16, 4)));
    const text = { body: cString(body), format, pos, selstart, selend, boxes, actbox, fonts: this.fonts };
    if (cursAt) {
      text.cursor = Array.from(new Float32Array(x.memory.buffer, cursAt >>> 0, 8));
      text.selection = Array.from({ length: boxesLen }, (_, i) => {
        const [bx, by, w, h, rotate] = new Float32Array(x.memory.buffer, (boxesAt >>> 0) + i * 20, 5);
        return { x: bx, y: by, w, h, rotate };
      });
    }
    return text;
  }

  set text({ body, format, pos = 0, selstart = 0, selend = 0, boxes, actbox = 0, fonts: names }) {
    const chars = [...body].length, info = format && new DataView(new ArrayBuffer(chars * CHARINFO_SIZE));
    format?.slice(0, chars).forEach(([flag, mat_nr, kern], i) => {
      info.setFloat32(i * CHARINFO_SIZE, kern, true);
      info.setInt16(i * CHARINFO_SIZE + 4, mat_nr, true);
      info.setUint8(i * CHARINFO_SIZE + 6, flag);
    });
    withString(body, (p) => withArrays([info && new Uint8Array(info.buffer)], ([i]) => x.curve_text_set(this.ob, p, i, pos, selstart, selend)));
    if (boxes) withArrays([Float32Array.from(boxes.flat())], ([b]) => x.curve_text_boxes_set(this.ob, b, boxes.length, actbox));
    names?.forEach((name, slot) => { const vfont = font(name); if (vfont) x.curve_text_font_set(this.ob, slot, vfont); });
  }

  // The names of its regular, bold, italic and bold italic fonts (null for the built-in font).
  get fonts() {
    const view = new DataView(x.memory.buffer), curve = this.#curve;
    return ['font', 'font_bold', 'font_italic', 'font_bold_italic'].map((name) => {
      const vfont = view.getUint32(curve + dna.TextCurve.properties[name].offset, true);
      return [...fonts].find(([, address]) => address === vfont)?.[0] ?? null;
    });
  }

  // Its modifier stack: [{ type, values (by RNA identifier), targets: { pointer property: object } }], as the
  // depsgraph evaluates a curve object's (deform modifiers on its points, the rest on its mesh).
  set modifiers(modifiers) {
    x.modifier_clear(this.ob);
    for (const { type, values = {}, targets = {} } of modifiers) {
      const { mesh } = blenderModifierDefinition(type), md = x.modifier_add(this.ob, mesh.type) >>> 0, pointers = modifierPointers(type);
      mesh.write(values)(new DataView(x.memory.buffer), md);
      for (const [name, target] of Object.entries(targets)) new DataView(x.memory.buffer).setUint32(md + pointers[name], target?.ob ?? 0, true);
    }
    this.main.tag(this.ob, ID_RECALC_GEOMETRY);
    this.main.relationsChanged();
  }

  // Sets a property by its RNA path (setCurvePath), then updates as RNA does: a point's spline gets its handles
  // calculated again.
  setPath(path, v) {
    const data = this.data;
    setCurvePath(data, path, v);
    this.data = data;
    const point = path.match(/^splines\[(\d+)\]\.(bezier_)?points/);
    if (point) x.curve_nurb_handles_calc(this.ob, Number(point[1]));
  }

  // Points a Curve pointer (follow_curve, bevel_object, taper_object) at another curve object, or at none.
  target(name, other) { x.curve_object_pointer_set(this.ob, located(name).offset, other?.ob ?? 0); }

  // Its transform, in Blender's axes, as Object RNA gives it.
  set transform(transform) {
    this.main.setTransform(this.ob, transform);
    this.main.evaluate();
  }

  // The mesh Blender draws for it (its modifiers included) as Main's depsgraph evaluates it with what it follows, valid
  // until the next evaluation, or null.
  evaluate() {
    this.main.evaluate();
    return this.main.evaluatedMesh(this.ob);
  }

  // Edit Mode: the object in it, active, with its edit data made; exit() loads the edit data back.
  enter() {
    this.main.setBase(this.ob, { select: true, active: true });
    this.main.setMode(this.ob, 'EDIT');
    x.curve_edit_make(this.ob);
  }
  exit() {
    x.curve_edit_load_free(this.main.bmain, this.ob);
    this.main.setMode(this.ob, 'OBJECT');
  }

  // Blender's curve and font operators in its context (an Edit Mode one with the object active).
  run(idname, props = {}) { return runOperator(this.main.C, idname, props); }
  poll(idname) { return pollOperator(this.main.C, idname); }
  enumItems(idname, prop) { return operatorEnumItems(this.main.C, idname, prop); }

  // view3d.select for a region pixel (sel_op an eSelectOp), as Blender picks in Edit Mode, in a 3D View region
  // (View3DRegion) given its size, view and window matrices.
  selectPick(region, [px, py], { dist = 75, sel_op = 1, deselect_all = true, select_passthrough = false } = {}) {
    return this.#inRegion(region, (C) => !!x.curve_select_pick(C, px, py, dist, sel_op, deselect_all, select_passthrough));
  }

  // Box, lasso and circle select (circle: Blender's circle rule) of the points for which inside(x, y) holds, in region
  // pixels, by an eSelectOp. Returns whether the selection changed.
  selectRegion(region, inside, { sel_op = 3, circle = false } = {}) {
    return this.#inRegion(region, (C) => {
      const count = x.curve_screen_verts(C, 0, 0);
      const co = withArrays([new Float32Array(2 * count)], ([p]) => { x.curve_screen_verts(C, p, count); return new Float32Array(x.memory.buffer, p, 2 * count).slice(); });
      const flags = Uint8Array.from({ length: count }, (_, i) => inside(co[2 * i], co[2 * i + 1]));
      return withArrays([flags], ([f]) => !!x.curve_select_region(C, sel_op, circle, f));
    });
  }

  // An operator invoked by an event in a 3D View region (font.selection_set's click), as Blender's handlers invoke
  // it: { type, value, x, y } with Blender's event type and value and region pixels (y up). One that goes modal gets
  // the next events from modal() until it ends. Returns its status.
  invoke(region, idname, event, props = {}) {
    this.cancelModal();
    const op = newOperator(idname, props);
    const status = this.#inRegion(region, (C) => x.operator_invoke(C, op, this.#event(C, event)));
    if (status & 1 && x.operator_modal_added(this.main.C)) this.running = op;
    else x.operator_free(op);
    return status;
  }
  modal(region, event) {
    if (!this.running) return 0;
    const status = this.#inRegion(region, (C) => x.operator_modal(C, this.running, this.#event(C, event)));
    if (!(status & 1)) this.cancelModal();
    return status;
  }
  cancelModal() {
    if (this.running) x.operator_free(this.running);
    this.running = null;
  }
  #inRegion(region, fn) {
    x.view3d_region_attach(this.main.C, region.address);
    try {
      return fn(this.main.C);
    } finally {
      x.view3d_region_attach(this.main.C, 0);
    }
  }
  #event(C, { type, value = 'PRESS', x: mx = 0, y: my = 0 }) {
    return withString('', (t) => x.wm_event_set(C, EVENT_TYPES.get(type), EVENT_VALUES.get(value), Math.round(mx), Math.round(my), 0, t,
      EVENT_TYPES.get(type), EVENT_VALUES.get(value))) >>> 0;
  }

  // A transform's steps start again from the edit data as it was when it began.
  snapshot() { x.curve_edit_snapshot(this.ob); }
  restore() { x.curve_edit_restore(this.ob); }
}

// eSelectOp.
export const SEL_OP_ADD = 1, SEL_OP_SUB = 2, SEL_OP_SET = 3, SEL_OP_XOR = 4;
// View3DOverlay.display_handle.
export const HANDLE_DISPLAY = { SELECTED: 0, ALL: 1, NONE: 2 };

// A 3D View's window region in the module (view3d_region_new): its size and matrices (column-major, Blender's axes).
export class View3DRegion {
  address = x.view3d_region_new() >>> 0;
  set({ width, height, viewmat, winmat, handles = 'SELECTED' }) {
    withArrays([Float32Array.from(viewmat), Float32Array.from(winmat)], ([v, w]) =>
      x.view3d_region_set(this.address, width, height, v, w, HANDLE_DISPLAY[handles]));
  }
}

// The mesh Blender evaluates for Curve data, as a Mesh of its own, or null. `transform` is the object's (Blender's
// axes, as Object RNA gives it), `modifiers` its stack ({ type, values, targets: { property: object name } }), and
// `targets` maps the object names its data and modifiers name to { data, transform } of those objects.
export function evaluateCurve(data, { transform, modifiers = [], targets = {} } = {}) {
  const made = [];
  const make = (d, t) => {
    const object = new CurveObject(d.type);
    made.push(object);
    object.data = d;
    if (t) object.transform = t;
    return object;
  };
  try {
    const object = make(data, transform);
    const others = new Map();
    const other = (name) => {
      if (!targets[name]) return null;
      if (!others.has(name)) {
        const target = make(targets[name].data, targets[name].transform);
        target.evaluate();
        others.set(name, target);
      }
      return others.get(name);
    };
    for (const name of CURVE_TARGETS) if (data.targets?.[name]) object.target(name, other(data.targets[name]));
    object.modifiers = modifiers.map((m) => ({ ...m, targets: Object.fromEntries(Object.entries(m.targets ?? {}).map(([k, v]) => [k, other(v)])) }));
    const mesh = object.evaluate();
    return mesh && ownedMesh(mesh);
  } finally {
    made.reverse().forEach((object) => object.free());
  }
}

// Sets a property of Curve data by its RNA path from the Curve (`bevel_depth`, `splines[0].bezier_points[1].co`,
// `splines[0].use_cyclic_u`, `text_boxes[0].width`, `body_format[2].kerning`, `follow_curve` to an object's name).
const BOX_FIELDS = ['x', 'y', 'width', 'height'];
const FORMAT_BITS = { use_bold: 1, use_italic: 2, use_underline: 4, use_small_caps: 16 };
export function setCurvePath(data, path, v) {
  const parts = [...path.matchAll(/(\w+)(?:\[(\d+)\])?/g)].map(([, name, index]) => [name, index === undefined ? undefined : Number(index)]);
  const [[name, index], ...rest] = parts;
  if (!rest.length) {
    if (CURVE_TARGETS.includes(name)) data.targets = { ...data.targets, [name]: v };
    else data.settings = { ...data.settings, [name]: v };
    // rna_Curve_resolution_u_update_data and _v: every spline takes the curve's resolution.
    if (name === 'resolution_u' || name === 'resolution_v') data.splines?.forEach((spline) => { spline[name] = v; });
    return;
  }
  const [[field, at], ...more] = rest;
  if (name === 'text_boxes') data.text.boxes[index][BOX_FIELDS.indexOf(field)] = v;
  else if (name === 'body_format') {
    const format = (data.text.format[index] ??= [0, 0, 0]);
    if (field === 'kerning') format[2] = v;
    else if (field === 'material_index') format[1] = v;
    else format[0] = v ? format[0] | FORMAT_BITS[field] : format[0] & ~FORMAT_BITS[field];
  } else if (name === 'splines') {
    const spline = data.splines[index];
    if (!more.length && splineFlags[field]) {
      const [bit, key] = splineFlags[field];
      spline[key] = v ? spline[key] | bit : spline[key] & ~bit;
    } else if (!more.length) spline[field] = v;
    else spline[field][at][more[0][0]] = v;
  }
}
