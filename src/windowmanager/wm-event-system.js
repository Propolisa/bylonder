// The window manager's event handling (wm_event_system.cc): one set of DOM listeners turns keys, clicks, drags and
// the wheel into Blender events and passes each down a handler stack until a keymap uses it. Modal handlers (a
// running transform, gesture or tool) sit on top; below them come the layers the app gives, top first: the mode
// (Edit Mode or Object Mode), then the 3D View, then Screen.
//
// An event is { type, value, shift, ctrl, alt, oskey, x, y, press, view, native } with Blender's event types in
// lower case ('a', 'leftmouse', 'wheelupmouse', 'left_ctrl') and values PRESS, RELEASE, CLICK, CLICK_DRAG.
// A press that no handler uses becomes a CLICK on release, or a CLICK_DRAG once the mouse moves past the drag
// threshold; `press` holds where the button went down.
import { keyType } from './input/keymap.js';

// U.drag_threshold_mouse, in pixels.
export const WM_DRAG_THRESHOLD_MOUSE = 3;
const BUTTONS = ['leftmouse', 'middlemouse', 'rightmouse', 'button4mouse', 'button5mouse'];

// `layers()` returns the handlers below the modal ones, top first; `viewAt(event)` the 3D View a pointer event is
// over (or null); `accepts(event)` filters out keys meant for text fields and other editors.
export function createEventSystem({ layers, viewAt, accepts = () => true }) {
  const modal = [];
  // Every event carries the mouse position, key presses included, as Blender's do.
  let press = null, mouse = { x: 0, y: 0 };

  const wmEvent = (native, type, value, extra = {}) => ({
    type, value, native,
    shift: native.shiftKey, ctrl: native.ctrlKey || native.metaKey, alt: native.altKey, oskey: native.metaKey,
    // DOM-style names for handlers written against them.
    shiftKey: native.shiftKey, ctrlKey: native.ctrlKey, altKey: native.altKey, metaKey: native.metaKey,
    x: native.clientX ?? mouse.x, y: native.clientY ?? mouse.y, clientX: native.clientX ?? mouse.x, clientY: native.clientY ?? mouse.y,
    ...extra,
  });

  // A modal handler { keymap(event), mousemove?(event), passthrough?(event), cancel?() } gets every event first;
  // what its keymap does not use is blocked unless passthrough(event) lets it continue.
  function dispatch(event) {
    for (const handler of [...modal]) {
      if (handler.keymap?.(event)) return true;
      if (!handler.passthrough?.(event)) return true;
    }
    for (const handler of layers()) if (handler?.(event)) return true;
    return false;
  }

  const keydown = (e) => {
    if (!accepts(e)) return;
    dispatch(wmEvent(e, keyType(e), 'PRESS', { repeat: e.repeat, view: viewAt(null) }));
  };
  const keyup = (e) => {
    if (accepts(e) && modal.length) dispatch(wmEvent(e, keyType(e), 'RELEASE', { view: viewAt(null) }));
  };
  const pointerdown = (e) => {
    if (e.pointerType === 'touch') return;
    const view = viewAt(e);
    if (!view && !modal.length) return;
    const type = BUTTONS[e.button];
    const handled = dispatch(wmEvent(e, type, 'PRESS', { view }));
    press = { type, x: e.clientX, y: e.clientY, view, native: e, handled, dragged: false };
    if (handled) e.preventDefault();
  };
  const pointermove = (e) => {
    mouse = { x: e.clientX, y: e.clientY };
    for (const handler of [...modal]) handler.mousemove?.(wmEvent(e, 'mousemove', 'NOTHING', { view: viewAt(e) }));
    if (!press || press.handled || press.dragged) return;
    if (Math.hypot(e.clientX - press.x, e.clientY - press.y) < WM_DRAG_THRESHOLD_MOUSE) return;
    press.dragged = true;
    dispatch(wmEvent(press.native, press.type, 'CLICK_DRAG', { view: press.view, press, x: press.x, y: press.y }));
  };
  const pointerup = (e) => {
    if (e.pointerType === 'touch') return;
    const type = BUTTONS[e.button], down = press?.type === type ? press : null;
    if (modal.length || down) dispatch(wmEvent(e, type, 'RELEASE', { view: viewAt(e), press: down }));
    if (down && !down.handled && !down.dragged) dispatch(wmEvent(down.native, type, 'CLICK', { view: down.view, press: down }));
    if (down) press = null;
  };
  const wheel = (e) => {
    const view = viewAt(e);
    if (!view && !modal.length) return;
    if (dispatch(wmEvent(e, e.deltaY < 0 ? 'wheelupmouse' : 'wheeldownmouse', 'PRESS', { view }))) e.preventDefault();
  };
  const contextmenu = (e) => { if (viewAt(e)) e.preventDefault(); };

  const listeners = [['keydown', keydown], ['keyup', keyup], ['pointerdown', pointerdown], ['pointermove', pointermove], ['pointerup', pointerup], ['wheel', wheel, { passive: false }], ['contextmenu', contextmenu]];
  for (const [name, fn, options] of listeners) addEventListener(name, fn, { capture: true, ...options });

  return {
    // WM_event_add_modal_handler: returns the function that removes it.
    addModal(handler) {
      modal.unshift(handler);
      return () => { const i = modal.indexOf(handler); if (i >= 0) modal.splice(i, 1); };
    },
    get modal() { return modal[0] ?? null; },
    dispatch,
    dispose() { for (const [name, fn, options] of listeners) removeEventListener(name, fn, { capture: true, ...options }); },
  };
}
