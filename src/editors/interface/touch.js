// The touch layer in one document (docs/mobile.md): the adapter (wm-touch.js), its press and hold feedback, the one
// time hint at the first touch, and a dragged value's readout with its soft Shift and Ctrl.
//   scale: { get(), preview(value), commit(value) }, Resolution Scale; hint(text) shows the hint (none: this document
//   shows none); keys(native, value) presses a key in the window (none: this document has no window).
import { createApp, h, reactive } from 'vue';
import TouchHold from './components/ui/touch-hold/TouchHold.vue';
import ValueDragOverlay from './components/ui/touch-bar/ValueDragOverlay.vue';
import './components/tailwind.css';
import { installTouch, RIGHT_CLICK_DELAY } from '../../windowmanager/input/wm-touch.js';

const HINT = 'bylonder:touch-hint';
const HINT_TEXT = 'Touch: two fingers pan, pinch zooms, three fingers orbit. Press and hold for a tooltip, then a right click. Pinch over the interface to change its scale.';
const MODIFIER_KEYS = { shift: { code: 'ShiftLeft', key: 'Shift' }, ctrl: { code: 'ControlLeft', key: 'Control' }, alt: { code: 'AltLeft', key: 'Alt' } };

export function mountTouch(win, { scale, hint, keys }) {
  const doc = win.document;
  const state = reactive({ hold: null, tip: null, modifiers: { shift: 'off', ctrl: 'off', alt: 'off' }, drag: null });
  const flags = () => ({ shiftKey: state.modifiers.shift !== 'off', ctrlKey: state.modifiers.ctrl !== 'off', altKey: state.modifiers.alt !== 'off' });
  // A modifier is its key held down from its first state to off ('once', 'locked' or 'held').
  const setModifier = (name, next) => {
    const was = state.modifiers[name];
    state.modifiers[name] = next;
    if ((was === 'off') !== (next === 'off')) keys?.({ ...MODIFIER_KEYS[name], ...flags() }, next === 'off' ? 'RELEASE' : 'PRESS');
  };
  // After a press: a latched modifier is used up.
  const pressed = () => { for (const name of Object.keys(state.modifiers)) if (state.modifiers[name] === 'once') setModifier(name, 'off'); };

  const host = doc.body.appendChild(doc.createElement('div'));
  const app = createApp({ render: () => [
    h(TouchHold, { hold: state.hold, tip: state.tip, duration: RIGHT_CLICK_DELAY }),
    state.drag && h(ValueDragOverlay, { drag: state.drag, modifiers: state.modifiers, onModifier: setModifier }),
  ] });
  app.mount(host);
  const ui = {
    hold: (point) => { state.hold = point; },
    tooltip: ({ text }, point) => { state.tip = { text, point }; },
    close: () => { state.tip = null; },
  };
  const firstTouch = (event) => {
    if (event.pointerType !== 'touch') return;
    win.removeEventListener('pointerdown', firstTouch, true);
    try {
      if (win.localStorage.getItem(HINT)) return;
      win.localStorage.setItem(HINT, '1');
    } catch { /* Storage blocked: the hint shows each visit. */ }
    hint(HINT_TEXT);
  };
  // A finger's value drag (NumberField.vue): its readout; a soft button still held when it ends is let go.
  const valueDrag = ({ detail }) => {
    state.drag = detail;
    if (!detail) for (const name of ['shift', 'ctrl']) if (state.modifiers[name] === 'held') setModifier(name, 'off');
  };
  // Before the adapter, which keeps a touch's events from the page.
  if (hint) win.addEventListener('pointerdown', firstTouch, true);
  doc.addEventListener('bl-value-drag', valueDrag);
  const remove = installTouch(win, { ui, scale, keys, input: { modifiers: flags, pressed } });
  return () => {
    remove();
    win.removeEventListener('pointerdown', firstTouch, true);
    doc.removeEventListener('bl-value-drag', valueDrag);
    app.unmount();
    host.remove();
  };
}

// Resolution Scale on the documents' size tokens (theme.css).
export const showScale = (documents, value) => documents.forEach((doc) => doc?.documentElement.style.setProperty('--bl-ui-scale', String(value)));
