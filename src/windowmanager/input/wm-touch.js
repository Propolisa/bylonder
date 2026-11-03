// Touch as Blender's input (docs/mobile.md). At the window's capture phase, before the event system, a finger becomes
// the mouse: its events reach the page again as clones, once it is known to be one finger (moved past the drag
// threshold, or lifted). Held still, it shows the control's tooltip, then right clicks. Two fingers over a view are
// the trackpad's scroll and magnify, three its scroll with Shift, which Blender's keymaps bind to the view's pan, zoom
// and orbit; over UI a pinch sets Resolution Scale. Two and three finger taps press Ctrl Z and Shift Ctrl Z.
// An element's computed `--bl-touch` (theme.css) says what two fingers do there: `view`, navigate it; `list`, scroll
// it; `ui` (the default), the browser scrolls it. A pinch outside a view always scales the UI.
// Held still past the tooltip's time over an element that carries (`data-touch-hold-drag`, an area's header), a drag
// carries it: the element gets `bl-hold-drag` events ({ phase: arm, start, move, end or cancel, x, y }) instead of the
// mouse's, armed at the hold so it can keep the browser from scrolling (its touchmove's preventDefault).

export const RIGHT_CLICK_DELAY = 800;
const TOOLTIP_DELAY = 400, TAP_TIME = 300, SCALE_RANGE = [0.5, 2];
// Blender's drag threshold for a tablet (U.drag_threshold_tablet): the nearest of its inputs to a finger.
const THRESHOLD = 10;
// Elements whose touches are their own: the touch layer's own controls.
const OWN = '.bl-touch-own', CARRIES = '[data-touch-hold-drag]';

const clones = new WeakSet();
const gestureWheels = new WeakSet();
// Whether a wheel event is a touch gesture's, which the event system takes as the trackpad's whatever the Preferences.
export const isTouchGesture = (event) => gestureWheels.has(event);
// Whether a pointer event is a finger on the touch layer's own controls (the touch bar, a value drag's soft keys), which
// are keys and buttons, not the mouse: every other touch reaches the page only as the adapter's mouse.
export const isTouchControl = (event) => event.pointerType === 'touch' && !clones.has(event);

const POINTER_FIELDS = ['pointerId', 'pointerType', 'isPrimary', 'clientX', 'clientY', 'screenX', 'screenY', 'width', 'height', 'pressure', 'tiltX', 'tiltY',
  'shiftKey', 'ctrlKey', 'altKey', 'metaKey', 'button', 'buttons'];
const fields = (event) => Object.fromEntries(POINTER_FIELDS.map((key) => [key, event[key]]));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const centroid = (points) => ({ x: points.reduce((s, p) => s + p.x, 0) / points.length, y: points.reduce((s, p) => s + p.y, 0) / points.length });
const spread = (points) => (points.length > 1 ? distance(points[0], points[1]) : 0);
// Whether the browser scrolls the page under a drag of (dx, dy) from an element: no element up to the root forbids it
// (CSS touch-action), as over UI, where a drag scrolls and never presses.
function browserPans(element, dx, dy) {
  const axis = Math.abs(dx) > Math.abs(dy) ? 'pan-x' : 'pan-y';
  for (let el = element; el?.nodeType === 1; el = el.parentElement) {
    const action = el.ownerDocument.defaultView.getComputedStyle(el).touchAction;
    if (action === 'none' || (action.includes('pan-') && !action.includes(axis))) return false;
  }
  return true;
}
const touchKind = (element) => (element?.nodeType === 1 && element.ownerDocument.defaultView.getComputedStyle(element).getPropertyValue('--bl-touch').trim()) || 'ui';
// Pointer Events' buttons mask for a button (left, middle, right).
const BUTTON_MASK = [1, 4, 2];
// The tooltip of the control under a point: its title, else its accessible name.
const tooltipOf = (element) => {
  const control = element?.closest?.('[title],[aria-label]');
  const text = control?.getAttribute('title') || control?.getAttribute('aria-label');
  return text ? { control, text } : null;
};

// `ui`: { hold(point, stage), tooltip(info, point), close() } draws the progress ring and the tooltip; `scale`:
// { get(), preview(value), commit(value) } is Resolution Scale; `keys(native, value)` presses a key in the window;
// `input` is the touch bar's: { modifiers(): { shiftKey, ctrlKey, altKey }, button(): the next press's (0 left, 1
// middle, 2 right), pressed(): after a press, point(at): where the last finger was }.
export function installTouch(win, { ui, scale, keys, input = {} }) {
  const doc = win.document, contacts = new Map();
  let mode = null, first = null, timers = [], gesture = null, tooltipOpen = false, lastTouch = 0;
  // The touches whose click the browser still sends but the touch layer used otherwise (a hold, a gesture).
  const swallowed = new Set();

  let button = 0;
  const dispatchClone = (type, event, { target = doc.elementFromPoint(event.clientX, event.clientY) || event.target, ...overrides } = {}) => {
    const held = type === 'pointerdown' || type === 'pointermove' ? BUTTON_MASK[button] : 0;
    const clone = new win.PointerEvent(type, { bubbles: true, cancelable: true, composed: true, view: win, ...fields(event), button: type === 'pointermove' ? -1 : button,
      buttons: held, ...input.modifiers?.(), ...overrides });
    clones.add(clone);
    target.dispatchEvent(clone);
    return clone;
  };
  // Keys through the window's event system (`keys(native, value)`; a document without one takes none).
  const sendKeys = (codes, value) => {
    const modifiers = { shiftKey: codes.includes('ShiftLeft'), ctrlKey: codes.includes('ControlLeft') };
    const ordered = value === 'PRESS' ? codes : [...codes].reverse();
    for (const code of ordered) keys?.({ code, key: code.startsWith('Key') ? code.slice(3).toLowerCase() : code.replace(/Left$/, ''), ...modifiers }, value);
  };
  const pressKeys = (codes) => { sendKeys(codes, 'PRESS'); sendKeys(codes, 'RELEASE'); };
  const clearTimers = () => { timers.forEach(clearTimeout); timers = []; ui.hold(null); };
  const swallowClick = (...ids) => ids.forEach((id) => swallowed.add(id));

  // One finger, once known: its held events replayed in order, then its own as they come.
  function commit() {
    clearTimers();
    mode = 'mouse';
    button = input.button?.() ?? 0;
    first.target.releasePointerCapture?.(first.down.pointerId);
    // The mouse comes to the finger before it presses, as Blender reads a press where the pointer last moved.
    dispatchClone('pointermove', first.down, { target: first.down.target, buttons: 0 });
    dispatchClone('pointerdown', first.down, { target: first.down.target });
    for (const move of first.moves) dispatchClone('pointermove', move);
  }
  function rightClick() {
    clearTimers();
    mode = 'done';
    ui.close();
    tooltipOpen = false;
    const at = first.down, target = first.down.target;
    dispatchClone('pointermove', at, { target, buttons: 0 });
    dispatchClone('pointerdown', at, { target, button: 2, buttons: 2 });
    dispatchClone('pointerup', at, { target, button: 2, buttons: 0 });
    input.pressed?.();
    const menu = new win.MouseEvent('contextmenu', { bubbles: true, cancelable: true, view: win, clientX: at.clientX, clientY: at.clientY, button: 2 });
    clones.add(menu);
    target.dispatchEvent(menu);
    swallowClick(at.pointerId);
  }
  const carry = (phase, at) => first.carry?.dispatchEvent(new win.CustomEvent('bl-hold-drag', { detail: { phase, x: at.clientX, y: at.clientY } }));
  const drop = (phase, at) => { carry(phase, at); first.carry = null; };
  function startHold() {
    const point = { x: first.down.clientX, y: first.down.clientY }, tip = tooltipOf(first.down.target);
    ui.hold(point);
    timers.push(setTimeout(() => {
      if (mode !== 'pending') return;
      first.carry = first.down.target.closest?.(CARRIES) ?? null;
      carry('arm', first.down);
      if (!tip) return;
      mode = 'tooltip';
      ui.tooltip(tip, point);
    }, TOOLTIP_DELAY));
    timers.push(setTimeout(() => (mode === 'pending' || mode === 'tooltip') && rightClick(), RIGHT_CLICK_DELAY));
  }

  // Two or more fingers: the trackpad over a view, Resolution Scale over UI.
  function startGesture() {
    if (first?.carry) drop('cancel', first.down);
    clearTimers();
    ui.close();
    tooltipOpen = false;
    const points = [...contacts.values()].map((c) => c.point);
    gesture = { ids: [...contacts.keys()], kind: touchKind(first.down.target), target: first.down.target, count: points.length, center: centroid(points), spread: spread(points),
      scale: scale.get(), value: scale.get(), moved: false, start: performance.now(), shift: false };
    mode = 'gesture';
  }
  function wheel(center, init) {
    const event = new win.WheelEvent('wheel', { bubbles: true, cancelable: true, view: win, clientX: center.x, clientY: center.y, deltaMode: 0, ...init });
    gestureWheels.add(event);
    gesture.target.dispatchEvent(event);
  }
  function moveGesture() {
    const points = [...contacts.values()].map((c) => c.point);
    if (points.length !== gesture.count) return;
    const center = centroid(points), size = spread(points), dx = center.x - gesture.center.x, dy = center.y - gesture.center.y;
    const ratio = gesture.spread && size ? size / gesture.spread : 1;
    if (!gesture.moved) {
      if (Math.hypot(dx, dy) < THRESHOLD && Math.abs(size - gesture.spread) < THRESHOLD) return;
      // Outside a view a gesture is one thing: a pinch scales the UI, a drag scrolls.
      gesture.pinch = gesture.count === 2 && Math.abs(size - gesture.spread) > Math.hypot(dx, dy);
      gesture.moved = true;
    }
    // A trackpad's deltas are fractions of a pixel, which tells them from a mouse wheel's notches.
    const fraction = (value) => (Number.isInteger(value) ? value + 1e-3 : value);
    const scroll = () => (dx || dy) && wheel(center, { deltaX: fraction(-dx), deltaY: fraction(-dy), shiftKey: gesture.shift });
    if (gesture.kind === 'view') {
      if (gesture.count === 3 && !gesture.shift) { sendKeys(['ShiftLeft'], 'PRESS'); gesture.shift = true; }
      scroll();
      if (gesture.count === 2 && ratio !== 1) wheel(center, { deltaY: fraction(-Math.log(ratio) * 100), ctrlKey: true });
    } else if (gesture.pinch) {
      gesture.value = Math.min(SCALE_RANGE[1], Math.max(SCALE_RANGE[0], gesture.value * ratio));
      scale.preview(gesture.value);
    } else if (gesture.kind === 'list') scroll();
    gesture.center = center;
    gesture.spread = size;
  }
  function endGesture() {
    if (gesture.shift) sendKeys(['ShiftLeft'], 'RELEASE');
    if (gesture.kind !== 'view' && gesture.value !== gesture.scale) scale.commit(gesture.value);
    if (!gesture.moved && performance.now() - gesture.start < TAP_TIME) {
      if (gesture.count === 2) pressKeys(['ControlLeft', 'KeyZ']);
      if (gesture.count === 3) pressKeys(['ShiftLeft', 'ControlLeft', 'KeyZ']);
    }
    swallowClick(...gesture.ids);
    gesture = null;
  }

  const own = (event) => event.pointerType !== 'touch' || clones.has(event) || event.target.closest?.(OWN);
  function pointerdown(event) {
    if (own(event)) return;
    event.stopImmediatePropagation();
    contacts.set(event.pointerId, { point: { x: event.clientX, y: event.clientY } });
    input.point?.({ x: event.clientX, y: event.clientY });
    if (contacts.size === 1) {
      swallowed.clear();
      if (tooltipOpen) { ui.close(); tooltipOpen = false; mode = 'done'; swallowClick(event.pointerId); return; }
      first = { down: event, target: event.target, moves: [] };
      event.target.releasePointerCapture?.(event.pointerId);
      mode = 'pending';
      startHold();
    } else if (['pending', 'tooltip', 'gesture'].includes(mode)) startGesture();
  }
  function pointermove(event) {
    if (own(event) || !contacts.has(event.pointerId)) return;
    event.stopImmediatePropagation();
    contacts.get(event.pointerId).point = { x: event.clientX, y: event.clientY };
    input.point?.(contacts.get(event.pointerId).point);
    if (mode === 'mouse' && event.pointerId === first.down.pointerId) dispatchClone('pointermove', event);
    else if (mode === 'carry' && event.pointerId === first.down.pointerId) carry('move', event);
    else if (mode === 'gesture') moveGesture();
    else if (mode === 'pending' || mode === 'tooltip') {
      first.moves.push(event);
      const dx = event.clientX - first.down.clientX, dy = event.clientY - first.down.clientY;
      if (Math.hypot(dx, dy) < THRESHOLD) return;
      clearTimers();
      if (first.carry) { ui.close(); mode = 'carry'; carry('start', event); carry('move', event); } else if (mode === 'tooltip') { ui.close(); mode = 'done'; } else if (browserPans(first.down.target, dx, dy)) mode = 'done';
      else commit();
    }
  }
  function pointerup(event) {
    if (own(event) || !contacts.has(event.pointerId)) return;
    event.stopImmediatePropagation();
    contacts.delete(event.pointerId);
    const cancelled = event.type === 'pointercancel';
    if (event.pointerId === first?.down.pointerId && first.carry) {
      if (mode === 'carry') { drop(cancelled ? 'cancel' : 'end', event); mode = 'done'; swallowClick(event.pointerId); } else drop('cancel', event);
    }
    if (mode === 'pending' && !cancelled) { commit(); dispatchClone('pointerup', event); focusField(event.target); input.pressed?.(); }
    // A press the browser took back (a system gesture) is released, so no button stays down.
    else if (mode === 'mouse' && event.pointerId === first.down.pointerId) { dispatchClone('pointerup', event); input.pressed?.(); }
    else if (mode === 'tooltip') { clearTimers(); tooltipOpen = true; mode = 'done'; swallowClick(event.pointerId); }
    else if (mode === 'pending') clearTimers();
    if (mode === 'gesture' && !contacts.size) endGesture();
    if (!contacts.size) { mode = null; first = null; lastTouch = performance.now(); }
  }
  // A tapped text field takes the focus, so the system keyboard opens.
  const focusField = (element) => element?.closest?.('input,textarea,select,[contenteditable]')?.focus();
  const click = (event) => {
    if (!event.isTrusted || !swallowed.delete(event.pointerId)) return;
    event.stopImmediatePropagation();
    event.preventDefault();
  };
  // The browser's own long press menu: the touch layer makes the right click.
  const contextmenu = (event) => { if (!clones.has(event) && (contacts.size || performance.now() < lastTouch + 1000)) { event.stopImmediatePropagation(); event.preventDefault(); } };

  const listeners = [['pointerdown', pointerdown], ['pointermove', pointermove], ['pointerup', pointerup], ['pointercancel', pointerup], ['click', click], ['contextmenu', contextmenu]];
  for (const [name, fn] of listeners) win.addEventListener(name, fn, { capture: true });
  return () => { for (const [name, fn] of listeners) win.removeEventListener(name, fn, { capture: true }); };
}

// The key configuration's factory settings for a touch device (docs/mobile.md Density), applied when no saved
// Preferences exist: Middle Mouse Action set to Pan, so two fingers pan the 3D Viewport.
export const touchKeyconfig = (win) => (win.matchMedia('(pointer: coarse)').matches ? { v3d_mmb_action: 'PAN' } : null);
