// The touch layer in one document (docs/mobile.md): the adapter (wm-touch.js), its press and hold feedback, and the
// one time hint at the first touch. `scale`: { get(), preview(value), commit(value) }, Resolution Scale; `hint(text)`
// shows the hint (none: this document shows none); `keys(native, value)` presses keys in the window.
import { createApp, h, reactive } from 'vue';
import TouchHold from './components/ui/touch-hold/TouchHold.vue';
import './components/tailwind.css';
import { installTouch, RIGHT_CLICK_DELAY } from '../../windowmanager/input/wm-touch.js';

const HINT = 'bylonder:touch-hint';
const HINT_TEXT = 'Touch: two fingers pan, pinch zooms, three fingers orbit. Press and hold for a tooltip, then a right click. Pinch over the interface to change its scale.';

export function mountTouch(win, { scale, hint, keys }) {
  const state = reactive({ hold: null, tip: null });
  const host = win.document.body.appendChild(win.document.createElement('div'));
  const app = createApp({ render: () => h(TouchHold, { hold: state.hold, tip: state.tip, duration: RIGHT_CLICK_DELAY }) });
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
  // Before the adapter, which keeps a touch's events from the page.
  if (hint) win.addEventListener('pointerdown', firstTouch, true);
  const remove = installTouch(win, { ui, scale, keys });
  return () => { remove(); win.removeEventListener('pointerdown', firstTouch, true); app.unmount(); host.remove(); };
}

// Resolution Scale on the documents' size tokens (theme.css).
export const showScale = (documents, value) => documents.forEach((doc) => doc?.documentElement.style.setProperty('--bl-ui-scale', String(value)));
