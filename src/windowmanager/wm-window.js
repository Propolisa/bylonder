// Blender's window manager in the module (tools/blender-port/wasm/wm-api.cc): Main's window, whose screen holds the
// editors' areas, and the browser as GHOST's system. The page lays the areas out and gives their rectangles, one way;
// its input becomes GHOST's events, which Blender's own event system handles with Blender's keymaps, modal handlers,
// macros and gestures. Each event returns the regions Blender tagged for redrawing.
import { blenderModule, newOperator } from '../bmesh/bmesh-wasm.js';
import { contextStruct, inPythonContext, registerClass } from '../python/bpy_rna.js';
import { provided } from '../port/wasm.js';
import '../python/bpy_interface.js';
import { setKeyconfigSource, setModalKeymaps, keymapsChanged } from './keyconfig.js';
import { blenderOperatorIds } from './wm-operators.js';

const { exports: x, withArrays, withString, cString } = blenderModule;

// Blender's space and region types (eSpace_Type, eRegion_Type).
export const SPACE_VIEW3D = 1;
export const RGN_TYPE_WINDOW = 0, RGN_TYPE_HEADER = 1, RGN_TYPE_UI = 4, RGN_TYPE_TOOLS = 5, RGN_TYPE_FOOTER = 11, RGN_TYPE_TOOL_HEADER = 12;
export const RGN_TYPE_ASSET_SHELF = 14, RGN_TYPE_ASSET_SHELF_HEADER = 15;
// The browser's input as wm_event takes it (BrowserEvent in wm-api.cc).
const KINDS = { pointermove: 0, buttondown: 1, buttonup: 2, wheel: 3, trackpad: 4, keydown: 5, keyup: 6 };

// A key configuration preset (presets/keyconfig) loaded as bpy.utils.keyconfig_set executes its file: as __main__,
// its Prefs class registered (Blender.py's), then its load(), which makes the key configuration of its name from its
// keymap data (generate_keymaps with the Preferences' and its Prefs' settings) through bl_keymap_utils.io; then made
// the active one. The tree runs a compiled preset's module once, at load, before the keymap data module its execfile
// names was loaded, so that binding is made here and the __main__ block run here.
const PRESET_DATA = { Blender: ['blender_default', 'blender_default.py'], Industry_Compatible: ['industry_compatible', 'industry_compatible_data.py'] };
const presetsRegistered = new Set();
// fn(context) with bpy.context Main's window manager's, whatever context Python draws or runs in (a Preferences
// change reloads the key configuration from inside a button's update).
const inContext = (C, fn) => inPythonContext(C, () => fn(contextStruct(C)));
export function keyconfigSet(C, name) {
  const preset = globalThis.__py_modules[`keyconfig.${name}`];
  if (!preset) return false;
  inContext(C, (context) => {
    const [binding, file] = PRESET_DATA[name];
    preset.__py_setattr__(binding, globalThis.__py_modules['bpy.utils'].execfile(`${preset.DIRNAME}/keymap_data/${file}`));
    if (preset.Prefs && !presetsRegistered.has(name)) registerClass(preset.Prefs);
    presetsRegistered.add(name);
    // Its keymap data, as load() hands it to keyconfig_init_from_data: the page's modal keymaps (keyconfig.js).
    const io = globalThis.__py_modules['bl_keymap_utils.io'], init = io.keyconfig_init_from_data;
    io.__py_setattr__('keyconfig_init_from_data', (kc, data) => { setModalKeymaps(data); return init(kc, data); });
    try {
      preset.load();
    } finally {
      io.__py_setattr__('keyconfig_init_from_data', init);
    }
    const keyconfigs = context.window_manager.keyconfigs;
    keyconfigs.active = keyconfigs.get(name);
  });
  keyconfigUpdated(C);
  return true;
}
// Blender's key configuration as WM_keyconfig_init makes it once Python's operators are registered: its C keymaps and
// drop boxes (wm_keyconfig_init), then bpy.utils.keyconfig_init: the Blender preset, then the active one when it is
// another. WM_keyconfig_reload (a Preferences change that alters keymaps, wm-api.cc) runs it again.
const keyconfigLoaded = new Set();
export function loadKeyconfig(C) {
  keyconfigLoaded.add(C);
  x.wm_keyconfig_init(C);
  keyconfigSet(C, 'Blender');
  const active = inContext(C, (context) => context.preferences.keymap.active_keyconfig);
  if (active !== 'Blender') keyconfigSet(C, active);
  setKeyconfigSource(() => contextStruct(C).window_manager.keyconfigs.user);
}
provided.wm_keyconfig_reload = (C) => loadKeyconfig(C);
// The user key configuration made again from the presets' keymaps and the Preferences' edits (WM_keyconfig_update),
// for Blender's window and the page's keymaps.
export function keyconfigUpdated(C) {
  x.wm_keyconfig_loaded();
  x.wm_keyconfig_update(C);
  keymapsChanged();
}
// Blender's keymaps and the operators Bylonder runs as Blender's, once, when Blender's window first takes an event
// (Blender's Python, the keyconfig, is loaded by then).
let configured = null;
const owned = new Set();
const allowed = () => [...blenderOperatorIds(), ...owned];
export function configureWindow(window) {
  if (configured) return;
  configured = window;
  if (!keyconfigLoaded.has(window.C)) loadKeyconfig(window.C);
  window.allow(allowed());
}
// Operators the window runs as Blender's besides those Bylonder registered with `blender: true`: those of an editor that
// is Blender's own (editors/screen/blender-area.js).
export function allowOperators(window, idnames) {
  idnames.forEach((idname) => owned.add(idname));
  if (configured) window.allow(allowed());
}

const withStrings = (strings, fn, pointers = []) => (strings.length
  ? withString(strings[0], (p) => withStrings(strings.slice(1), fn, [...pointers, p]))
  : fn(pointers));

// An area of a space type in the window's screen.
export class Area {
  constructor(window, spacetype) {
    this.window = window;
    this.pointer = x.wm_area_new(window.C, spacetype, -1) >>> 0;
  }
  // Its rectangle and those of the regions it shows ({ [regiontype]: rect }), in page pixels ({ x, y, width, height }
  // from the page's top left); the regions left out are hidden.
  layout(rect, regions = {}) {
    const entries = [[-1, rect], ...Object.entries(regions).map(([type, r]) => [Number(type), r])];
    const rects = Int32Array.from(entries.flatMap(([type, r]) => [type, r.x, r.y, r.width, r.height].map(Math.round)));
    withArrays([rects], ([p]) => x.wm_area_layout(this.window.C, this.pointer, p, entries.length));
  }
  // Of the region types given, those Blender shows by its own polls and flags (the asset shelf), which layout() then
  // lists as Blender shows them: { [regiontype]: height in pixels }.
  regionsShown(types) {
    return withArrays([Int32Array.from(types)], ([p]) => JSON.parse(cString(x.wm_area_regions_shown(this.window.C, this.pointer, p, types.length))));
  }
  // A 3D View's view, as regionView3D (editors/space_view3d/view3d-project.js) gives it.
  set view3d({ viewmat, winmat, persp, ofs = [0, 0, 0], dist = 0, cameraView = false }) {
    withArrays([Float32Array.from(viewmat), Float32Array.from(winmat), Float32Array.from(ofs)],
      ([v, w, o]) => x.wm_view3d_set(this.window.C, this.pointer, v, w, persp, o, dist, cameraView));
  }
  // The 3D View as Blender's navigation left it: { ofs, viewquat, dist, persp (RV3D_ORTHO, RV3D_PERSP, RV3D_CAMOB),
  // view (RV3D_VIEW_*) } in Blender's axes.
  get view3d() {
    const out = withArrays([new Float32Array(10)], ([p]) => { x.wm_view3d_get(this.pointer, p); return Array.from(new Float32Array(x.memory.buffer, p, 10)); });
    return { ofs: out.slice(0, 3), viewquat: out.slice(3, 7), dist: out[7], persp: out[8], view: out[9] };
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
  // An operator invoked in an area's window region as a gizmo invokes it (wm_area_operator_invoke): returns what
  // event() does.
  invoke(area, idname, props = {}) {
    const op = newOperator(idname, props);
    try {
      return JSON.parse(cString(x.wm_area_operator_invoke(this.C, area.pointer, op)));
    } finally {
      x.operator_free(op);
    }
  }
  // One input event: `kind` a key of KINDS; `data` its numbers (the pointer's page x and y, or a button's number and 0,
  // then a pen's mode, pressure and tilts (wm-event-system.js pen); the
  // wheel's axis and steps; a trackpad's subtype, x, y, deltas and inversion; a key's repeat); a key's DOM `code`,
  // `key` and text. Returns wm-api.cc's event_result: { redraw: [[area, regiontype], ...], modal, finished: [{ idname,
  // undo }], popup: { type, title, text, idname, values } or { menu } or null, unhandled: [{ type, value, modifier,
  // xy, press, direction, repeat }] } with page coordinates.
  event(kind, data, { code = '', key = '', text = '' } = {}, time = performance.now()) {
    const numbers = Int32Array.from({ length: 6 }, (_, i) => Math.round(data[i] ?? 0));
    const json = withArrays([numbers], ([p]) => withStrings([code, key, text], ([c, k, t]) => cString(x.wm_event(this.C, KINDS[kind], p, c, k, t, time))));
    return JSON.parse(json);
  }
  // Whether the window has work without input (timers: panel animations, operators' timers, jobs; queued notifiers):
  // then tick() each animation frame, which handles it and returns what event() does.
  get pending() { return !!x.wm_pending(this.C); }
  tick() { return JSON.parse(cString(x.wm_tick(this.C))); }
  // The gestures running (box, circle, lasso) as wm-gesture.cc's wm_gestures gives them, to draw, in page pixels.
  get gestures() { return JSON.parse(cString(x.wm_gestures(this.C))); }
}
