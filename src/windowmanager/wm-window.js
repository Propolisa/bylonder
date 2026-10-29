// Blender's window manager in the module (tools/blender-port/wasm/wm-api.cc): Main's window, whose screen holds the
// editors' areas, and the browser as GHOST's system. The page lays the areas out and gives their rectangles, one way;
// its input becomes GHOST's events, which Blender's own event system handles with Blender's keymaps, modal handlers,
// macros and gestures. Each event returns the regions Blender tagged for redrawing.
import { blenderModule, flatProperties } from '../bmesh/bmesh-wasm.js';
import { defaultKeymaps } from './keyconfig.js';
import { blenderOperatorIds } from './wm-operators.js';

const { exports: x, withArrays, withString, cString } = blenderModule;

// Blender's space and region types (eSpace_Type, eRegion_Type).
export const SPACE_VIEW3D = 1;
export const RGN_TYPE_WINDOW = 0, RGN_TYPE_HEADER = 1, RGN_TYPE_UI = 4, RGN_TYPE_TOOLS = 5, RGN_TYPE_TOOL_HEADER = 12;
// The browser's input as wm_event takes it (BrowserEvent in wm-api.cc).
const KINDS = { pointermove: 0, buttondown: 1, buttonup: 2, wheel: 3, trackpad: 4, keydown: 5, keyup: 6 };

// Keyconfig data (keymap_data/blender_default.py's generate_keymaps) into Blender's default key configuration, as
// Python's keyconfig_init_from_data loads it through KeyMaps.new and KeyMapItems.new.
const MODIFIERS = ['shift', 'ctrl', 'alt', 'oskey', 'hyper'];
const modifier = (value) => (value === true ? 1 : value === false || value === undefined ? 0 : value);
export function loadKeyconfig(C, keyconfig) {
  for (const [name, { space_type, region_type, modal = false }, { items }] of keyconfig) {
    const km = withString(name, (n) => withString(space_type, (s) => withString(region_type, (r) => x.wm_keymap_new(C, n, s, r, modal))));
    for (const [idname, kmi, data] of items) addItem(km, idname, kmi, data?.properties);
  }
  x.wm_keyconfig_loaded();
}
// Blender's keymaps and the operators Bylonder runs as Blender's, once, when Blender's window first takes an event
// (Blender's Python, the keyconfig, is loaded by then).
let configured = false;
const owned = new Set();
const allowed = () => [...blenderOperatorIds(), ...owned];
export function configureWindow(window) {
  if (configured) return;
  configured = true;
  loadKeyconfig(window.C, defaultKeymaps());
  window.allow(allowed());
}
// Operators the window runs as Blender's besides those Bylonder registered with `blender: true`: those of an editor that
// is Blender's own (editors/screen/blender-area.js).
export function allowOperators(window, idnames) {
  idnames.forEach((idname) => owned.add(idname));
  if (configured) window.allow(allowed());
}
function addItem(km, idname, { type, value, any = false, key_modifier = '', direction = '', repeat = false, ...held }, properties) {
  const strings = [idname, type, value, key_modifier, direction];
  const kmi = withArrays([Int32Array.from(MODIFIERS, (key) => modifier(held[key]))], ([mods]) =>
    withStrings(strings, ([i, t, v, k, d]) => x.wm_keymap_item_new(km, i, t, v, any, mods, k, d, repeat))) >>> 0;
  for (const [name, value] of flatProperties(Object.fromEntries(properties ?? []))) {
    const text = typeof value === 'string' ? value : Array.isArray(value) && value.every((v) => typeof v === 'string') ? value.join(',') : null;
    const numbers = Float64Array.from(text === null ? [value].flat() : [], Number);
    withString(name, (n) => (text === null
      ? withArrays([numbers], ([p]) => x.wm_keymap_item_property_set(kmi, n, p, numbers.length, 0))
      : withString(text, (t) => x.wm_keymap_item_property_set(kmi, n, 0, 0, t))));
  }
}
const withStrings = (strings, fn, pointers = []) => (strings.length
  ? withString(strings[0], (p) => withStrings(strings.slice(1), fn, [...pointers, p]))
  : fn(pointers));

// An area of a space type in the window's screen.
export class Area {
  constructor(window, spacetype) {
    this.window = window;
    this.pointer = x.wm_area_new(window.C, spacetype) >>> 0;
  }
  // Its rectangle and those of the regions it shows ({ [regiontype]: rect }), in page pixels ({ x, y, width, height }
  // from the page's top left); the regions left out are hidden.
  layout(rect, regions = {}) {
    const entries = [[-1, rect], ...Object.entries(regions).map(([type, r]) => [Number(type), r])];
    const rects = Int32Array.from(entries.flatMap(([type, r]) => [type, r.x, r.y, r.width, r.height].map(Math.round)));
    withArrays([rects], ([p]) => x.wm_area_layout(this.window.C, this.pointer, p, entries.length));
  }
  // A 3D View's view, as regionView3D (editors/space_view3d/view3d-project.js) gives it.
  set view3d({ viewmat, winmat, persp }) {
    withArrays([Float32Array.from(viewmat), Float32Array.from(winmat)], ([v, w]) => x.wm_view3d_set(this.pointer, v, w, persp));
  }
  // A region drawn by its type (or its overlay), as region-draw.cc records it.
  draw(regiontype, overlay = false) { return JSON.parse(cString(x.wm_region_draw(this.window.C, this.pointer, regiontype, overlay))); }
  // Runs fn(C) with this area's region as the context's.
  inContext(regiontype, fn) {
    x.wm_area_context_set(this.window.C, this.pointer, regiontype);
    try {
      return fn(this.window.C);
    } finally {
      x.wm_area_context_set(this.window.C, 0, 0);
    }
  }
  // What its operator shows in its header (ED_area_status_text), or ''.
  get status() { return cString(x.wm_area_status(this.pointer)); }
  free() { x.wm_area_free(this.window.C, this.pointer); }
}

// Main's window (a BlenderMain's context).
export class Window {
  constructor(main) {
    this.main = main;
    this.C = main.C;
  }
  set size({ width, height }) { x.wm_window_size_set(this.C, width, height); }
  // The operators (Python idnames) events may run; the others pass their events on, unhandled, to the page.
  allow(idnames) { withString(idnames.join('\n'), (p) => x.wm_operators_allow(p)); }
  // The page's keymaps used an unhandled press: no click or drag of it follows.
  pressHandled() { x.wm_event_press_handled(this.C); }
  area(spacetype) { return new Area(this, spacetype); }
  // One input event: `kind` a key of KINDS; `data` its numbers (the pointer's page x and y; a button's number; the
  // wheel's axis and steps; a trackpad's subtype, x, y, deltas and inversion; a key's repeat); a key's DOM `code`,
  // `key` and text. Returns wm-api.cc's event_result: { redraw: [[area, regiontype], ...], modal, finished: [{ idname,
  // undo }], popup: { type, title, text, idname, values } or { menu } or null, unhandled: [{ type, value, modifier,
  // xy, press, direction, repeat }] } with page coordinates.
  event(kind, data, { code = '', key = '', text = '' } = {}, time = performance.now()) {
    const numbers = Int32Array.from({ length: 6 }, (_, i) => Math.round(data[i] ?? 0));
    const json = withArrays([numbers], ([p]) => withStrings([code, key, text], ([c, k, t]) => cString(x.wm_event(this.C, KINDS[kind], p, c, k, t, time))));
    return JSON.parse(json);
  }
}
