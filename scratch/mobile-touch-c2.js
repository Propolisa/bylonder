// The touch layer in one document (docs/mobile.md): the adapter (wm-touch.js), its press and hold feedback, the one
// time hint at the first touch, and where the window has keys (`keys`), the touch bar with its shortcut bubbles, quick
// keys pie and keyboard sheet, and a dragged value's readout.
//   scale: { get(), preview(value), commit(value) }, Resolution Scale; hint(text): shows the hint; keys(native,
//   value): presses a key in the window; modal(): the running modal operator's { name, takes(identifier) } or null;
//   mode(): the 3D Viewport's mode for the pie (OBJECT, EDIT, SCULPT, POSE); pinned: the pie's own keys (index: keys).
import { createApp, h, reactive } from 'vue';
import TouchHold from './components/ui/touch-hold/TouchHold.vue';
import TouchBar from './components/ui/touch-bar/TouchBar.vue';
import ShortcutBubbles from './components/ui/touch-bar/ShortcutBubbles.vue';
import KeysPie from './components/ui/touch-bar/KeysPie.vue';
import KeyboardSheet from './components/ui/touch-bar/KeyboardSheet.vue';
import ValueDragOverlay from './components/ui/touch-bar/ValueDragOverlay.vue';
import './components/tailwind.css';
import { installTouch, RIGHT_CLICK_DELAY } from '../../windowmanager/input/wm-touch.js';
import { keyOf } from '../../windowmanager/input/keymap.js';
import { modalBubbles, pieSlots } from './touch-keys.js';

const HINT = 'bylonder:touch-hint';
const HINT_TEXT = 'Touch: two fingers pan, pinch zooms, three fingers orbit. Press and hold for a tooltip, then a right click. Pinch over the interface to change its scale.';
const MODIFIER_KEYS = { shift: { code: 'ShiftLeft', key: 'Shift' }, ctrl: { code: 'ControlLeft', key: 'Control' }, alt: { code: 'AltLeft', key: 'Alt' } };

export function mountTouch(win, { scale, hint, keys, modal = () => null, mode = () => 'OBJECT', pinned = () => ({}) }) {
  const doc = win.document;
  const state = reactive({ hold: null, tip: null, bar: false, modifiers: { shift: 'off', ctrl: 'off', alt: 'off' }, button: 0, point: { x: win.innerWidth / 2, y: win.innerHeight / 2 },
    bubbles: [], pie: null, keyboard: false, drag: null });
  const flags = () => ({ shiftKey: state.modifiers.shift !== 'off', ctrlKey: state.modifiers.ctrl !== 'off', altKey: state.modifiers.alt !== 'off' });
  const press = (type, extra = {}) => {
    const native = { ...keyOf(type), ...flags(), ...extra };
    keys(native, 'PRESS');
    keys(native, 'RELEASE');
    pressed();
  };
  // A sticky modifier is its key held down from its first state to off.
  const setModifier = (name, next) => {
    const was = state.modifiers[name];
    state.modifiers[name] = next;
    if ((was === 'off') !== (next === 'off')) keys({ ...MODIFIER_KEYS[name], ...flags() }, next === 'off' ? 'RELEASE' : 'PRESS');
  };
  // After a press: a latched modifier or button is used up.
  function pressed() {
    for (const name of Object.keys(state.modifiers)) if (state.modifiers[name] === 'once') setModifier(name, 'off');
    state.button = 0;
    refresh();
  }
  const refresh = () => {
    const running = keys && modal();
    state.bubbles = running ? modalBubbles(running.name, running.takes) : [];
  };
  const wheel = (direction) => {
    const target = doc.elementFromPoint(state.point.x, state.point.y);
    target?.dispatchEvent(new win.WheelEvent('wheel', { bubbles: true, cancelable: true, view: win, clientX: state.point.x, clientY: state.point.y, deltaY: direction * 100, deltaMode: 0, ...flags() }));
    pressed();
  };

  const overlay = doc.body.appendChild(doc.createElement('div'));
  const overlayApp = createApp({ render: () => [
    h(TouchHold, { hold: state.hold, tip: state.tip, duration: RIGHT_CLICK_DELAY }),
    state.pie && h(KeysPie, { center: state.pie, slots: pieSlots(mode(), pinned()), onPress: (slot) => { state.pie = null; press(slot.type, { shiftKey: slot.shift || flags().shiftKey, ctrlKey: slot.ctrl || flags().ctrlKey, altKey: slot.alt || flags().altKey }); }, onClose: () => { state.pie = null; } }),
    state.drag && h(ValueDragOverlay, { drag: state.drag, modifiers: state.modifiers, onModifier: setModifier }),
  ] });
  overlayApp.mount(overlay);
  // The bar sits under the window's areas, from the first touch.
  const bar = keys ? doc.body.appendChild(doc.createElement('div')) : null;
  const barApp = bar && createApp({ render: () => state.bar && [
    state.bubbles.length ? h(ShortcutBubbles, { items: state.bubbles, onPress: (type, item) => press(type, item ? { shiftKey: item.shift, ctrlKey: item.ctrl, altKey: item.alt } : {}) }) : null,
    state.keyboard ? h(KeyboardSheet, { onPress: (type) => press(type), onClose: () => { state.keyboard = false; } }) : null,
    h(TouchBar, { state, onModifier: setModifier, onButton: (b) => { state.button = b; }, onWheel: wheel,
      onKeys: () => { state.pie = state.pie ? null : { ...state.point }; }, onKeyboard: () => { state.keyboard = !state.keyboard; } }),
  ] });
  barApp?.mount(bar);

  const ui = {
    hold: (point) => { state.hold = point; },
    tooltip: ({ text }, point) => { state.tip = { text, point }; },
    close: () => { state.tip = null; },
  };
  const input = { modifiers: flags, button: () => state.button, pressed, point: (at) => { state.point = at; } };
  const firstTouch = (event) => {
    if (event.pointerType !== 'touch') return;
    state.bar = !!keys;
    win.removeEventListener('pointerdown', firstTouch, true);
    try {
      if (win.localStorage.getItem(HINT)) return;
      win.localStorage.setItem(HINT, '1');
    } catch { /* Storage blocked: the hint shows each visit. */ }
    hint?.(HINT_TEXT);
  };
  // A mouse used: the touch bar goes until the next touch.
  const mouse = (event) => {
    if (event.pointerType === 'mouse' && event.isTrusted && state.bar) { state.bar = false; win.addEventListener('pointerdown', firstTouch, true); }
  };
  // A finger's value drag (NumberField.vue): its readout and soft modifiers.
  const valueDrag = (event) => { state.drag = event.detail; };
  // Before the adapter, which keeps a touch's events from the page.
  win.addEventListener('pointerdown', firstTouch, true);
  win.addEventListener('pointerdown', mouse, true);
  doc.addEventListener('bl-value-drag', valueDrag);
  const timer = keys && win.setInterval(() => state.bar && refresh(), 150);
  const remove = installTouch(win, { ui, scale, keys, input });
  return () => {
    remove();
    win.clearInterval(timer);
    win.removeEventListener('pointerdown', firstTouch, true);
    win.removeEventListener('pointerdown', mouse, true);
    doc.removeEventListener('bl-value-drag', valueDrag);
    overlayApp.unmount(); overlay.remove();
    barApp?.unmount(); bar?.remove();
  };
}

// Resolution Scale on the documents' size tokens (theme.css).
export const showScale = (documents, value) => documents.forEach((doc) => doc?.documentElement.style.setProperty('--bl-ui-scale', String(value)));
