// The browser's input for the window manager. Where Blender's window takes it (`blender`, wm-window.js's route: the
// 3D Views in Object Mode), each DOM event is a GHOST event that Blender's own event system handles with its keymaps
// and modal handlers; the events it leaves unhandled, with Blender's values (click, drag, double click), go down the
// page's handler stack. Elsewhere the page's handler stack takes the DOM events itself: modal handlers (a running
// transform, gesture or tool) on top, then the layers the app gives, top first: the mode (Edit Mode or Object Mode),
// then the 3D View, then Screen. A modal handler of the page takes the events before Blender's window does.
//
// An event is { type, value, shift, ctrl, alt, oskey, x, y, press, view, native } with Blender's event types in
// lower case ('a', 'leftmouse', 'wheelupmouse', 'left_ctrl') and values PRESS, RELEASE, CLICK, CLICK_DRAG.
// On the page's own path a press that no handler uses becomes a CLICK on release, or a CLICK_DRAG once the mouse moves
// past the drag threshold, where the mouse then is; `press` holds where the button went down and a CLICK_DRAG's
// `direction` which way it left.
import { keyType } from './input/keymap.js';

// U.drag_threshold_mouse, in pixels.
export const WM_DRAG_THRESHOLD_MOUSE = 3;
const BUTTONS = ['leftmouse', 'middlemouse', 'rightmouse', 'button4mouse', 'button5mouse'];
// WM_event_drag_direction: the eighth of a turn the pointer left its press in (y up), from east counterclockwise.
const DIRECTIONS = ['EAST', 'NORTH_EAST', 'NORTH', 'NORTH_WEST', 'WEST', 'SOUTH_WEST', 'SOUTH', 'SOUTH_EAST'];
export const dragDirection = (dx, dy) => DIRECTIONS[(Math.round((4 * Math.atan2(-dy, dx)) / Math.PI) + 8) % 8];

// WM_event_drag_start_xy: the event at a drag's press, for what Blender places at the drag's start.
export const dragStart = (event) => (event.value === 'CLICK_DRAG' && event.press ? { ...event, x: event.press.x, y: event.press.y } : event);

// wmEventModifierFlag.
const KM_SHIFT = 1, KM_CTRL = 2, KM_ALT = 4, KM_OSKEY = 8;
// The page's name of a Blender event type.
const pageType = (type) => (type === 'SPACE' ? 'spacebar' : type.toLowerCase());

const DIGITS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
// blender-port: wm_event_system.cc wm_event_add_ghostevent's Emulate 3 Button Mouse (Alt or OS key with the left button
// is the middle one, its release too) and Emulate Numpad (the number row is the numpad), for the events the page takes
// itself; Blender's window applies them to the events it takes. `input`: { emulate_3_button, emulate_3_button_modifier
// ('ALT' or 'OSKEY'), emulate_numpad }.
export function emulateInput(event, input, state) {
  if (input.emulate_numpad && DIGITS.includes(event.type)) event.type = 'numpad_' + DIGITS.indexOf(event.type);
  if (!input.emulate_3_button || event.type !== 'leftmouse') return event;
  const [modifier, domKey] = input.emulate_3_button_modifier === 'OSKEY' ? ['oskey', 'metaKey'] : ['alt', 'altKey'];
  if (event.value === 'PRESS' && event[modifier]) {
    Object.assign(event, { type: 'middlemouse', [modifier]: false, [domKey]: false });
    state.emulating = true;
  } else if (event.value === 'RELEASE') {
    if (state.emulating) Object.assign(event, { type: 'middlemouse', [modifier]: false, [domKey]: false });
    state.emulating = false;
  }
  return event;
}

// GHOST's trackpad events from the browser's wheel events (GHOST_TTrackpadEventSubTypes: Scroll 1, Magnify 4): a
// pinch arrives as the wheel with Ctrl, a two-finger drag as a wheel of pixel deltas that are not a mouse wheel's
// notches. Null for a mouse wheel. Blender applies the Preferences' scroll direction to them.
const TRACKPAD_SCROLL = 1, TRACKPAD_MAGNIFY = 4;
// A pen's state with a pointer event, as GHOST's tablet data (wm-api.cc tablet_data): mode (0 none, 1 stylus, 2 eraser:
// the eraser end or button), pressure and tilt (degrees to a full lean) in thousandths.
const TABLET_STYLUS = 1, TABLET_ERASER = 2;
export const pen = (e) => (e.pointerType !== 'pen' ? [0, 0, 0, 0]
  : [e.buttons & 32 || e.button === 5 ? TABLET_ERASER : TABLET_STYLUS, Math.round(e.pressure * 1000), Math.round((e.tiltX / 90) * 1000), Math.round((e.tiltY / 90) * 1000)]);
// GHOST reports a pen's eraser contact (the Pointer Events' button 5) as the left button with the eraser's tablet mode.
const ERASER_CONTACT = 5;
const ghostButton = (e) => (e.pointerType === 'pen' && e.button === ERASER_CONTACT ? 0 : e.button);
export function trackpadGesture(e) {
  if (e.deltaMode !== 0) return null;
  if (e.ctrlKey && !Number.isInteger(e.deltaY)) return { subtype: TRACKPAD_MAGNIFY, dx: Math.round(-e.deltaY * 4), dy: 0 };
  if (e.deltaX === 0 && Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= 50) return null;
  return { subtype: TRACKPAD_SCROLL, dx: Math.round(e.deltaX), dy: Math.round(e.deltaY) };
}

// `layers()` returns the handlers below the modal ones, top first; `viewAt(event)` the 3D View a pointer event is
// over (or null); `accepts(event)` filters out keys meant for text fields and other editors; `hover(event)` gets the
// pointer's motion while no modal handler runs (the gizmo map's highlighting); `blender` is Blender's window
// ({ takes(native, view): whether it handles the event, send(kind, data, strings, view): the event's result,
// keeps(native): whether what it leaves unhandled stays its own, from a window of its own }).
export function createEventSystem({ layers, viewAt, accepts = () => true, hover = () => {}, blender = null, input = () => ({}) }) {
  const modal = [], emulation = { emulating: false };
  // Every event carries the mouse position, key presses included, as Blender's do.
  let press = null, mouse = { x: 0, y: 0 }, blenderModal = false, buttons = 0;

  const wmEvent = (native, type, value, extra = {}) => emulateInput({
    type, value, native,
    shift: native.shiftKey, ctrl: native.ctrlKey || native.metaKey, alt: native.altKey, oskey: native.metaKey,
    // DOM-style names for handlers written against them.
    shiftKey: native.shiftKey, ctrlKey: native.ctrlKey, altKey: native.altKey, metaKey: native.metaKey,
    x: native.clientX ?? mouse.x, y: native.clientY ?? mouse.y, clientX: native.clientX ?? mouse.x, clientY: native.clientY ?? mouse.y,
    ...extra,
  }, input(), emulation);

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

  // An event Blender's window left unhandled, as the page's.
  const unhandled = (native, { type, value, modifier, xy: [x, y], press: [px, py], direction, repeat }) => {
    const ctrl = !!(modifier & (KM_CTRL | KM_OSKEY));
    return {
      type: pageType(type), value, native, repeat, direction: direction || undefined,
      shift: !!(modifier & KM_SHIFT), ctrl, alt: !!(modifier & KM_ALT), oskey: !!(modifier & KM_OSKEY),
      shiftKey: !!(modifier & KM_SHIFT), ctrlKey: ctrl, altKey: !!(modifier & KM_ALT), metaKey: !!(modifier & KM_OSKEY),
      x, y, clientX: x, clientY: y, press: value === 'PRESS' ? undefined : { x: px, y: py },
      text: value === 'PRESS' && native.key?.length === 1 ? native.key : '',
      view: viewAt(native.clientX === undefined ? null : native) ?? viewAt(null),
    };
  };
  // Sends a DOM event to Blender's window; true when it took it. Its unhandled events go down the page's stack.
  function toBlender(native, kind, data, strings = {}) {
    const view = viewAt(native.clientX === undefined ? null : native);
    if (modal.length || !blender?.takes(native, view)) return false;
    const result = blender.send(kind, data, strings, view, native);
    blenderModal = result.modal;
    if (blender.keeps?.(native)) return true;
    for (const event of result.unhandled) {
      if (event.value === 'RELEASE' && !event.type.endsWith('mouse')) continue;
      const handled = dispatch(unhandled(native, event));
      if (handled && event.value === 'PRESS') blender.pressHandled();
      if (handled) native.preventDefault?.();
    }
    if (result.finished.length || result.modal) native.preventDefault?.();
    return true;
  }
  const keyEvent = (e) => ({ code: e.code, key: e.key, text: e.key?.length === 1 ? e.key : '' });

  const keydown = (e) => {
    if (!accepts(e)) return;
    if (toBlender(e, 'keydown', [e.repeat ? 1 : 0], keyEvent(e))) return;
    dispatch(wmEvent(e, keyType(e), 'PRESS', { repeat: e.repeat, view: viewAt(null) }));
  };
  const keyup = (e) => {
    if (!accepts(e)) return;
    if (toBlender(e, 'keyup', [0], keyEvent(e))) return;
    if (modal.length) dispatch(wmEvent(e, keyType(e), 'RELEASE', { view: viewAt(null) }));
  };
  const pointerdown = (e) => {
    if (e.pointerType === 'touch') return;
    if (toBlender(e, 'buttondown', [ghostButton(e), 0, ...pen(e)])) { buttons++; return; }
    const view = viewAt(e);
    if (!view && !modal.length) return;
    const type = BUTTONS[e.button];
    const event = wmEvent(e, type, 'PRESS', { view }), handled = dispatch(event);
    // An operator that finished and passed the press through (FINISHED | PASS_THROUGH, WM_HANDLER_HANDLED) leaves no
    // click, but a drag.
    press = { type, x: e.clientX, y: e.clientY, view, native: e, handled, clicked: handled || !!event.handled, dragged: false };
    if (handled) e.preventDefault();
  };
  const pointermove = (e) => {
    mouse = { x: e.clientX, y: e.clientY };
    // A pen's moves between frames reach Blender each, for smooth strokes.
    if (e.pointerType === 'pen') for (const c of e.getCoalescedEvents?.().slice(0, -1) ?? []) toBlender(e, 'pointermove', [c.clientX, c.clientY, ...pen(c)]);
    const sent = toBlender(e, 'pointermove', [e.clientX, e.clientY, ...pen(e)]);
    for (const handler of [...modal]) handler.mousemove?.(wmEvent(e, 'mousemove', 'NOTHING', { view: viewAt(e) }));
    if (!modal.length && !blenderModal && !press && !buttons) hover(wmEvent(e, 'mousemove', 'NOTHING', { view: viewAt(e) }));
    if (sent || !press || press.handled || press.dragged) return;
    if (Math.hypot(e.clientX - press.x, e.clientY - press.y) < WM_DRAG_THRESHOLD_MOUSE) return;
    press.dragged = true;
    const direction = dragDirection(e.clientX - press.x, e.clientY - press.y);
    dispatch(wmEvent(press.native, press.type, 'CLICK_DRAG', { view: press.view, press, x: e.clientX, y: e.clientY, direction }));
  };
  const pointerup = (e) => {
    if (e.pointerType === 'touch') return;
    if (toBlender(e, 'buttonup', [ghostButton(e), 0, ...pen(e)])) { buttons = Math.max(0, buttons - 1); return; }
    buttons = 0;
    const type = BUTTONS[e.button], down = press?.type === type ? press : null;
    if (modal.length || down) dispatch(wmEvent(e, type, 'RELEASE', { view: viewAt(e), press: down }));
    if (down && !down.clicked && !down.dragged) dispatch(wmEvent(down.native, type, 'CLICK', { view: down.view, press: down }));
    if (down) press = null;
  };
  const wheel = (e) => {
    const pad = input().trackpad && trackpadGesture(e);
    if (pad ? toBlender(e, 'trackpad', [pad.subtype, e.clientX, e.clientY, pad.dx, pad.dy, 0]) : toBlender(e, 'wheel', [0, e.deltaY < 0 ? 1 : -1])) {
      e.preventDefault();
      return;
    }
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
    // The running modal handler: the page's, else Blender's window's operator.
    get modal() { return modal[0] ?? (blenderModal ? { blender: true } : null); },
    dispatch,
    dispose() { for (const [name, fn, options] of listeners) removeEventListener(name, fn, { capture: true, ...options }); },
  };
}
