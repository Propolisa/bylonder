// The 3D Views as areas of Blender's window (windowmanager/wm-window.js): their window regions are their canvases, their
// views Babylon's cameras, and in Object Mode their input runs Blender's keymaps and modal operators on Main, which the
// scene sync keeps equal to the scene: flushed before Blender's code runs, viewed after, with the selected meshes'
// geometry given to it while an operator runs, an undo step when one finishes, and the popups it opens drawn by the
// page. What Blender leaves unhandled goes to the page's keymaps (wm-event-system.js).
import { Window, configureWindow, allowOperators, SPACE_VIEW3D, RGN_TYPE_WINDOW, RGN_TYPE_ASSET_SHELF, RGN_TYPE_ASSET_SHELF_HEADER } from '../../windowmanager/wm-window.js';
import { hasOperator } from '../../windowmanager/wm-operators.js';
import { operatorNames } from '../../bmesh/bmesh-wasm.js';
import { regionView3D } from './view3d-project.js';
import { RV3D_CAMOB } from './navigation.js';
import { openModulePopup, runBlenderOperator } from '../object/object-operators.js';
import { tagRedraw } from '../../draw/overlay-tool.js';
import { ticking, watchRedraws } from '../../windowmanager/wm-areas.js';

// The popups an invoke opens (operator_popup's numbers).
const POPUPS = [null, 'CONFIRM', 'ENUM_MENU', 'PROPS', 'LAYOUT'];
const pageRect = (rect) => ({ x: rect.left, y: rect.top, width: rect.width, height: rect.height });
// Mesh Edit Mode, the Grease Pencil modes and the 3D View's navigation (view3d.rotate, view_axis, ...) are Blender's on
// Main: their operators the page has no code of its own for are Blender's (the Knife, brush strokes, the view's).
export const blenderView3DOperators = () => operatorNames().filter((idname) => /^(mesh|grease_pencil|view3d)\./.test(idname) && !hasOperator(idname));

//   sync: the scene's (createMainSync); views(): the 3D Views; takes(): whether Blender's window takes input now (Object
//   Mode); host: runBlenderOperator's options (transaction, notify, keying, commit, wm, pointer, view), menu(name, event)
//   opening a menu of the page; before(): what the page finishes before an operator runs (a pending Add); wake(): the
//   views draw again.
export function createView3DWindow({ sync, views, takes, host, menu, before = () => {}, wake }) {
  const window = new Window(sync.blender);
  const areas = new Map();
  let running = false;
  // A view's asset shelf draws again when Blender tags it (its asset list read, a hover); a view Blender tagged (its
  // operators' notifiers, a stroke's end) draws again, its camera following the view Blender's navigation left (smooth
  // view's steps come with the window's timers).
  const follow = (view, a) => {
    const rv3d = a.view3d;
    if (rv3d.persp === RV3D_CAMOB) view.enterCameraView();
    else view.nav.follow(rv3d);
  };
  const redrawn = (redraw) => {
    for (const [view, a] of areas) {
      if (redraw.some(([p, type]) => p === a.pointer && (type === RGN_TYPE_ASSET_SHELF || type === RGN_TYPE_ASSET_SHELF_HEADER))) view.regions?.draw();
      if (redraw.some(([p, type]) => p === a.pointer && type === RGN_TYPE_WINDOW)) { follow(view, a); wake(); }
    }
  };
  watchRedraws(redrawn);

  // A view's area, laid out from the page (unless `layout` is false: as it last was).
  function area(view, layout = true) {
    configureWindow(window);
    if (!areas.has(view)) areas.set(view, window.area(SPACE_VIEW3D));
    else if (!layout) return areas.get(view);
    window.size = { width: innerWidth, height: innerHeight };
    const a = areas.get(view), rect = pageRect(view.canvas.getBoundingClientRect());
    a.layout(rect, { [RGN_TYPE_WINDOW]: rect, ...view.regions?.rects() });
    a.view3d = regionView3D(view);
    return a;
  }

  function popup({ menu: name, type, title, text, idname, values }, event) {
    if (name) return menu(name, event);
    if (POPUPS[type] === 'PROPS') return;
    // The values it was invoked with, but rna_type, which is no value to set.
    const set = Object.fromEntries(Object.entries(values).filter(([, value]) => value !== null));
    const finish = (chosen) => chosen && runBlenderOperator(sync, idname, { ...set, ...(chosen === true ? {} : chosen) }, { ...host, event: null });
    openModulePopup(sync, { type: POPUPS[type], title, text }, event, { idname, finish });
  }

  // Blender's 3D View operators, decided at the first input, once the page has registered its own (view3d.select and
  // the other picks), which areas are laid out before.
  let inputTaken = false;
  function takeInput() {
    if (inputTaken) return;
    inputTaken = true;
    allowOperators(window, blenderView3DOperators());
  }

  function send(kind, data, strings, view) {
    takeInput();
    for (const v of views()) area(v);
    const acting = kind !== 'pointermove' || running;
    // An operator may start: Main gets the scene, and the selected meshes' geometry while it runs.
    if (acting && !running) {
      before();
      sync.begin({ meshes: sync.selected() });
    }
    let result;
    const step = sync.blender.undoStep;
    host.keying(() => { result = window.event(kind, data, strings); });
    redrawn(result.redraw);
    if (!acting) return result;
    running = result.modal;
    if (running) sync.view();
    else sync.end();
    if (running) host.notify(areas.get(view)?.status ?? '');
    else if (result.finished.length) host.notify('');
    // Operators that push their own undo steps (sculpt and paint strokes) are not flagged OPTYPE_UNDO.
    if (result.finished.some(({ undo }) => undo) || sync.blender.undoStep !== step) host.commit();
    if (result.popup) popup(result.popup, host.pointer());
    tagRedraw();
    ticking();
    return result;
  }

  // An operator of the view's navigation gizmo, invoked as a gizmo invokes it on a left press at the pointer (modal
  // ones run in the window until the release): view3d.rotate, move, zoom, view_axis, view_persportho.
  function invoke(view, idname, props = {}, native = null) {
    takeInput();
    if (native) send('pointermove', [native.clientX, native.clientY], {}, view);
    const result = window.invoke(area(view), idname, props);
    redrawn(result.redraw);
    running = result.modal;
    tagRedraw();
    ticking();
    return result;
  }

  // A touch gesture as a trackpad's (GHOST's trackpad events: a drag orbits, with Shift it pans, a pinch magnifies),
  // which Blender's 3D View keymap navigates by: { dx, dy, magnify, shift } at the pointer { x, y }.
  const SHIFT = { code: 'ShiftLeft', key: 'Shift' };
  function trackpad(view, { x, y, dx, dy = 0, magnify = false, shift = false }) {
    if (shift) send('keydown', [0], SHIFT, view);
    send('trackpad', [magnify ? 4 : 1, x, y, dx, dy, 0], {}, view);
    if (shift) send('keyup', [0], SHIFT, view);
  }

  return {
    takes: (native, view) => running || (takes() && !!view && native.pointerType !== 'touch'),
    send,
    invoke,
    trackpad,
    // A view's area, laid out from its elements (its header, tool header and sidebar are view.regions').
    area,
    pressHandled: () => window.pressHandled(),
  };
}
