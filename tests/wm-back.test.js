// The phone's Back (wm-back.js): it closes the topmost open thing, the latest registered first, a dialog before them
// and a frame's before the page's own, and never leaves the app unless there are unsaved changes and the user agrees.
import assert from 'node:assert/strict';
import { onBack, back, installBack } from '../src/windowmanager/wm-back.js';

// A window whose history has the app's entry and whatever is pushed above it; back() pops one and fires popstate.
function fakeWindow({ dialogs = [], frames = [] } = {}) {
  const listeners = new Set(), entries = [null];
  const win = {
    location: { href: 'https://example.test/' },
    document: { querySelectorAll: (selector) => (selector === 'iframe' ? frames : dialogs.filter((d) => d.open)) },
    history: {
      get state() { return entries.at(-1); },
      get length() { return entries.length; },
      pushState: (state) => entries.push(state),
      back() { entries.pop(); if (!entries.length) win.left = true; else listeners.forEach((fn) => fn()); },
    },
    addEventListener: (type, fn) => listeners.add(fn),
    removeEventListener: (type, fn) => listeners.delete(fn),
    left: false,
  };
  return win;
}

{
  const closed = [];
  const releaseDrawer = onBack(() => (closed.push('drawer'), true));
  const releaseMenu = onBack(() => (closed.push('menu'), true));
  const dialog = { open: true, close() { this.open = false; closed.push('dialog'); } };
  const frame = { contentWindow: { __bylonderBack: () => (closed.includes('frame') ? false : (closed.push('frame'), true)) } };
  const win = fakeWindow({ dialogs: [dialog], frames: [frame] });
  const remove = installBack(win, { unsaved: () => false });
  assert.equal(win.history.length, 2, 'one entry above the app');
  for (let i = 0; i < 3; i++) win.history.back();
  assert.deepEqual(closed, ['dialog', 'frame', 'menu'], 'a dialog, then the frame, then the latest registered');
  releaseMenu();
  win.history.back();
  assert.deepEqual(closed.at(-1), 'drawer');
  releaseDrawer();
  releaseDrawer();
  win.history.back();
  assert.equal(win.left, false, 'with nothing open Back stays in the app');
  assert.equal(win.history.length, 2, 'and keeps its entry');
  remove();
}

{
  const win = fakeWindow();
  let asked = 0, agree = false;
  installBack(win, { unsaved: () => true, confirmLeave: () => (asked++, agree) });
  win.history.back();
  assert.equal(asked, 1, 'unsaved changes: Back asks');
  assert.equal(win.left, false, 'and stays when the user declines');
  agree = true;
  win.history.back();
  assert.equal(win.left, true, 'and leaves when the user agrees');
}

assert.equal(back({ querySelectorAll: () => [] }), false, 'nothing open: nothing closes');
console.log('Back button: closes the topmost open thing, stays in the app, asks before leaving unsaved changes');
