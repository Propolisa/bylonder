// The touch layer in one document (docs/mobile.md): the adapter (wm-touch.js), its press and hold feedback, the one
// time hint at the first touch, a dragged value's readout with its soft Shift and Ctrl, and where the document has a
// window (`keys`), the touch bar from the first touch with its shortcut bubbles, quick keys pie and keyboard sheet.
//   scale: { get(), preview(value), commit(value) }, Resolution Scale; hint(text) shows the hint (none: this document
//   shows none); keys(native, value) presses a key in the window (none: this document has no window); modal(): the
//   running modal operator's { name: its modal keymap, takes(identifier) } or null; mode(): the 3D Viewport's mode for
//   the pie (OBJECT, EDIT, SCULPT, POSE).
import { createApp, h, reactive } from 'vue';
import TouchHold from './components/ui/touch-hold/TouchHold.vue';
import ValueDragOverlay from './components/ui/touch-bar/ValueDragOverlay.vue';
import TouchBar from './components/ui/touch-bar/TouchBar.vue';
import ShortcutBubbles from './components/ui/touch-bar/ShortcutBubbles.vue';
import KeysPie from './components/ui/touch-bar/KeysPie.vue';
import KeyboardSheet from './components/ui/touch-bar/KeyboardSheet.vue';
import './components/tailwind.css';
import { installTouch, RIGHT_CLICK_DELAY } from '../../windowmanager/input/wm-touch.js';
import { keyOf } from '../../windowmanager/input/keymap.js';
import { modalBubbles, pieSlots } from './touch-keys.js';

const HINT = 'bylonder:touch-hint';
const HINT_TEXT = 'Touch: two fingers pan, pinch zooms, three fingers orbit. Press and hold for a tooltip, then a right click. Pinch over the interface to change its scale.';
const MODIFIER_KEYS = { shift: { code: 'ShiftLeft', key: 'Shift' }, ctrl: { code: 'ControlLeft', key: 'Control' }, alt: { code: 'AltLeft', key: 'Alt' } };

export function mountTouch(win, { scale, hint, keys, modal = () => null, mode = () => 'OBJECT' }) {
  const doc = win.document;
  const state = reactive({ hold: null, tip: null, modifiers: { shift: 'off', ctrl: 'off', alt: 'off' }, drag: null,
    bar: !!keys && !!win.matchMedia?.('(pointer: coarse)').matches, button: 0, point: { x: win.innerWidth / 2, y: win.innerHeight / 2 }, bubbles: [], pie: null, keyboard: false });
  const flags = () => ({ shiftKey: state.modifiers.shift !== 'off', ctrlKey: state.modifiers.ctrl !== 'off', altKey: state.modifiers.alt !== 'off' });
  // A modifier is its key held down from its first state to off ('once', 'locked' or 'held').
  const setModifier = (name, next) => {
    const was = state.modifiers[name];
    state.modifiers[name] = next;
    if ((was === 'off') !== (next === 'off')) keys?.({ ...MODIFIER_KEYS[name], ...flags() }, next === 'off' ? 'RELEASE' : 'PRESS');
  };
  // After a press: a latched modifier or button is used up, and the bubbles follow the operator's new state.
  function pressed() {
    for (const name of Object.keys(state.modifiers)) if (state.modifiers[name] === 'once') setModifier(name, 'off');
    state.button = 0;
    refresh();
  }
  const refresh = () => {
    const running = state.bar && modal(), bubbles = running ? modalBubbles(running.name, running.takes) : [];
    if (JSON.stringify(bubbles) !== JSON.stringify(state.bubbles)) state.bubbles = bubbles;
  };
  // A key pressed and released with the sticky modifiers, and those a key of a bubble or the pie names.
  const press = ({ type, shift, ctrl, alt }) => {
    const held = flags(), native = { ...keyOf(type), shiftKey: held.shiftKey || !!shift, ctrlKey: held.ctrlKey || !!ctrl, altKey: held.altKey || !!alt };
    keys(native, 'PRESS');
    keys(native, 'RELEASE');
    pressed();
  };
  const wheel = (direction) => {
    const { x, y } = state.point;
    doc.elementFromPoint(x, y)?.dispatchEvent(new win.WheelEvent('wheel', { bubbles: true, cancelable: true, view: win, clientX: x, clientY: y, deltaY: direction * 100, deltaMode: 0, ...flags() }));
    pressed();
  };

  const host = doc.body.appendChild(doc.createElement('div'));
  const app = createApp({ render: () => [
    h(TouchHold, { hold: state.hold, tip: state.tip, duration: RIGHT_CLICK_DELAY }),
    state.drag && h(ValueDragOverlay, { drag: state.drag, modifiers: state.modifiers, onModifier: setModifier }),
    state.pie && h(KeysPie, { center: state.pie, slots: pieSlots(mode()), onPress: (slot) => { state.pie = null; press(slot); }, onClose: () => { state.pie = null; } }),
  ] });
  app.mount(host);
  // The bar is the window's last row, under its areas: there from the start on a touch screen, so the layout does not
  // shift under the first tap; on a device with a mouse, from the first touch.
  const bar = keys && doc.body.appendChild(doc.createElement('div'));
  const barApp = bar && createApp({ render: () => state.bar && [
    state.keyboard && h(KeyboardSheet, { onPress: (type) => press({ type }), onClose: () => { state.keyboard = false; } }),
    h(TouchBar, { state, modal: state.bubbles.length > 0, onModifier: setModifier, onButton: (button) => { state.button = button; }, onWheel: wheel,
      onKeys: () => { state.pie = state.pie ? null : { ...state.point }; }, onKeyboard: () => { state.keyboard = !state.keyboard; } },
    () => h(ShortcutBubbles, { items: state.bubbles, onPress: press })),
  ] });
  barApp?.mount(bar);
  const ui = {
    hold: (point) => { state.hold = point; },
    tooltip: ({ text }, point) => { state.tip = { text, point }; },
    close: () => { state.tip = null; },
  };
  const firstTouch = (event) => {
    if (event.pointerType !== 'touch') return;
    state.bar = !!keys;
    win.removeEventListener('pointerdown', firstTouch, true);
    if (!hint) return;
    try {
      if (win.localStorage.getItem(HINT)) return;
      win.localStorage.setItem(HINT, '1');
    } catch { /* Storage blocked: the hint shows each visit. */ }
    hint(HINT_TEXT);
  };
  // A mouse used: the touch bar goes until the next touch.
  const mouse = (event) => {
    if (event.pointerType === 'mouse' && event.isTrusted && state.bar) { state.bar = false; win.addEventListener('pointerdown', firstTouch, true); }
  };
  // A finger's value drag (NumberField.vue): its readout; a soft button still held when it ends is let go.
  const valueDrag = ({ detail }) => {
    state.drag = detail;
    if (!detail) for (const name of ['shift', 'ctrl']) if (state.modifiers[name] === 'held') setModifier(name, 'off');
  };
  // Before the adapter, which keeps a touch's events from the page.
  win.addEventListener('pointerdown', firstTouch, true);
  win.addEventListener('pointerdown', mouse, true);
  doc.addEventListener('bl-value-drag', valueDrag);
  // A modal operator may start or change without a tap of the bar's (a key, a tool): its bubbles follow.
  const timer = keys && win.setInterval(refresh, 150);
  const input = { modifiers: flags, button: () => state.button, pressed, point: (at) => { state.point = at; } };
  const remove = installTouch(win, { ui, scale, keys, input });
  return () => {
    remove();
    win.clearInterval(timer);
    win.removeEventListener('pointerdown', firstTouch, true);
    win.removeEventListener('pointerdown', mouse, true);
    doc.removeEventListener('bl-value-drag', valueDrag);
    app.unmount();
    host.remove();
    barApp?.unmount();
    bar?.remove();
  };
}

// Resolution Scale on the documents' size tokens (theme.css).
export const showScale = (documents, value) => documents.forEach((doc) => doc?.documentElement.style.setProperty('--bl-ui-scale', String(value)));
// The display's pixel ratio on the documents' size tokens (theme.css rounds the UI unit to its pixels), followed as it
// changes (a zoom, a move to another display).
export function followPixelRatio(win, documents) {
  const ratio = win.devicePixelRatio || 1;
  documents.forEach((doc) => doc?.documentElement.style.setProperty('--bl-dpr', String(ratio)));
  win.matchMedia(`(resolution: ${ratio}dppx)`).addEventListener('change', () => followPixelRatio(win, documents), { once: true });
}
