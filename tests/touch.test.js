// The touch adapter (src/windowmanager/input/wm-touch.js) on a stand-in window: what reaches the page for a tap, a drag,
// a press and hold, two and three fingers over a view, and a pinch over UI.
import assert from 'node:assert/strict';
import { installTouch, isTouchGesture } from '../src/windowmanager/input/wm-touch.js';

class FakePointerEvent extends Event {
  constructor(type, { bubbles, cancelable, composed, ...init } = {}) {
    super(type, { bubbles, cancelable, composed });
    Object.assign(this, { button: 0, buttons: 0, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false }, init);
  }
}
class FakeElement extends EventTarget {
  constructor(win, parent, style = {}) { super(); Object.assign(this, { nodeType: 1, parentElement: parent, ownerDocument: win.document, style: { touchAction: 'auto', '--bl-touch': '', ...style } }); }
  closest(selector) { return selector.includes('title') && this.title ? this : null; }
  getAttribute(name) { return this[name] ?? null; }
  releasePointerCapture() {}
  dispatchEvent(event) { this.seen.push(event); return super.dispatchEvent(event); }
  get seen() { return (this._seen ??= []); }
}
function fakeWindow() {
  const win = new EventTarget();
  Object.assign(win, { PointerEvent: FakePointerEvent, MouseEvent: FakePointerEvent, WheelEvent: FakePointerEvent });
  win.document = { elementFromPoint: () => win.target, defaultView: win };
  win.getComputedStyle = (el) => ({ touchAction: el.style.touchAction, getPropertyValue: (name) => el.style[name] ?? '' });
  const root = new FakeElement(win, null, { touchAction: 'pan-x pan-y', '--bl-touch': 'ui' });
  win.view = new FakeElement(win, root, { touchAction: 'none', '--bl-touch': 'view' });
  win.ui = new FakeElement(win, root, { '--bl-touch': 'ui' });
  win.ui.title = 'Solid\nDisplay the object solid';
  return win;
}
const touchEvent = (win, type, id, x, y, target) => {
  const event = new FakePointerEvent(type, { pointerType: 'touch', pointerId: id, clientX: x, clientY: y, isPrimary: id === 1 });
  Object.defineProperty(event, 'target', { value: target });
  win.dispatchEvent(event);
};
const wait = (ms) => new Promise((done) => setTimeout(done, ms));
function setup() {
  const win = fakeWindow(), log = { keys: [], scale: [], ui: [] };
  const ui = { hold: () => {}, tooltip: (tip) => log.ui.push(['tooltip', tip.text]), close: () => log.ui.push(['close']) };
  const scale = { value: 1, get: () => scale.value, preview: (v) => log.scale.push(['preview', v]), commit: (v) => { scale.value = v; log.scale.push(['commit', v]); } };
  installTouch(win, { ui, scale, keys: (native, value) => log.keys.push(`${value} ${native.code}`) });
  return { win, log, types: (el) => el.seen.map((e) => `${e.type}${e.button > 0 ? ':' + e.button : ''}`) };
}

// A tap is the mouse moved to the finger, then a press and release there.
{
  const { win, types } = setup();
  win.target = win.view;
  touchEvent(win, 'pointerdown', 1, 100, 100, win.view);
  touchEvent(win, 'pointerup', 1, 100, 100, win.view);
  assert.deepEqual(types(win.view), ['pointermove', 'pointerdown', 'pointerup']);
}
// A drag over a view replays the moves it held back, then follows the finger.
{
  const { win, types } = setup();
  win.target = win.view;
  touchEvent(win, 'pointerdown', 1, 100, 100, win.view);
  touchEvent(win, 'pointermove', 1, 104, 100, win.view);
  assert.deepEqual(types(win.view), [], 'held back under the threshold');
  touchEvent(win, 'pointermove', 1, 130, 100, win.view);
  touchEvent(win, 'pointermove', 1, 150, 100, win.view);
  touchEvent(win, 'pointerup', 1, 150, 100, win.view);
  assert.deepEqual(types(win.view), ['pointermove', 'pointerdown', 'pointermove', 'pointermove', 'pointermove', 'pointerup']);
}
// A drag over UI is the browser's scroll: nothing is pressed.
{
  const { win, types } = setup();
  win.target = win.ui;
  touchEvent(win, 'pointerdown', 1, 100, 100, win.ui);
  touchEvent(win, 'pointermove', 1, 100, 160, win.ui);
  touchEvent(win, 'pointercancel', 1, 100, 160, win.ui);
  assert.deepEqual(types(win.ui), []);
}
// Held still: the tooltip, then the right click (press, release and the context menu of the right button).
{
  const { win, log, types } = setup();
  win.target = win.ui;
  touchEvent(win, 'pointerdown', 1, 100, 100, win.ui);
  await wait(450);
  assert.deepEqual(log.ui, [['tooltip', 'Solid\nDisplay the object solid']]);
  await wait(400);
  assert.deepEqual(types(win.ui), ['pointermove', 'pointerdown:2', 'pointerup:2', 'contextmenu:2']);
  touchEvent(win, 'pointerup', 1, 100, 100, win.ui);
}
// Lifted after the tooltip: it stays, and the next tap only closes it.
{
  const { win, log, types } = setup();
  win.target = win.ui;
  touchEvent(win, 'pointerdown', 1, 100, 100, win.ui);
  await wait(450);
  touchEvent(win, 'pointerup', 1, 100, 100, win.ui);
  touchEvent(win, 'pointerdown', 1, 100, 100, win.ui);
  touchEvent(win, 'pointerup', 1, 100, 100, win.ui);
  assert.deepEqual(log.ui, [['tooltip', 'Solid\nDisplay the object solid'], ['close']]);
  assert.deepEqual(types(win.ui), []);
}
// Two fingers over a view: the trackpad's scroll as they move together, its magnify (Ctrl) as they spread.
{
  const { win } = setup();
  win.target = win.view;
  touchEvent(win, 'pointerdown', 1, 100, 100, win.view);
  touchEvent(win, 'pointerdown', 2, 140, 100, win.view);
  touchEvent(win, 'pointermove', 1, 100, 130, win.view);
  touchEvent(win, 'pointermove', 2, 140, 130, win.view);
  touchEvent(win, 'pointermove', 2, 200, 130, win.view);
  touchEvent(win, 'pointerup', 1, 100, 130, win.view);
  touchEvent(win, 'pointerup', 2, 200, 130, win.view);
  const wheels = win.view.seen.filter((e) => e.type === 'wheel');
  assert.ok(wheels.every(isTouchGesture), 'gesture wheels');
  assert.ok(wheels.some((e) => !e.ctrlKey && e.deltaY < 0), 'scroll follows the fingers down');
  assert.ok(wheels.some((e) => e.ctrlKey && e.deltaY < 0), 'spreading magnifies');
  assert.ok(wheels.every((e) => !Number.isInteger(e.deltaY)), 'a trackpad\'s fractional deltas');
  assert.ok(!win.view.seen.some((e) => e.type.startsWith('pointer')), 'no press');
}
// Three fingers over a view: the trackpad's scroll with Shift held.
{
  const { win, log } = setup();
  win.target = win.view;
  for (const id of [1, 2, 3]) touchEvent(win, 'pointerdown', id, 100 + id * 30, 100, win.view);
  for (const id of [1, 2, 3]) touchEvent(win, 'pointermove', id, 160 + id * 30, 100, win.view);
  for (const id of [1, 2, 3]) touchEvent(win, 'pointerup', id, 160 + id * 30, 100, win.view);
  assert.deepEqual(log.keys, ['PRESS ShiftLeft', 'RELEASE ShiftLeft']);
  assert.ok(win.view.seen.filter((e) => e.type === 'wheel').every((e) => e.shiftKey));
}
// A pinch over UI sets Resolution Scale, written once on release.
{
  const { win, log } = setup();
  win.target = win.ui;
  touchEvent(win, 'pointerdown', 1, 100, 100, win.ui);
  touchEvent(win, 'pointerdown', 2, 140, 100, win.ui);
  touchEvent(win, 'pointermove', 2, 180, 100, win.ui);
  touchEvent(win, 'pointerup', 1, 100, 100, win.ui);
  touchEvent(win, 'pointerup', 2, 180, 100, win.ui);
  assert.deepEqual(log.scale, [['preview', 2], ['commit', 2]]);
}
// Two and three finger taps: Ctrl Z and Shift Ctrl Z.
{
  const { win, log } = setup();
  win.target = win.view;
  for (const n of [2, 3]) {
    for (let id = 1; id <= n; id++) touchEvent(win, 'pointerdown', id, 100 + id * 40, 100, win.view);
    for (let id = 1; id <= n; id++) touchEvent(win, 'pointerup', id, 100 + id * 40, 100, win.view);
  }
  assert.deepEqual(log.keys, ['PRESS ControlLeft', 'PRESS KeyZ', 'RELEASE KeyZ', 'RELEASE ControlLeft',
    'PRESS ShiftLeft', 'PRESS ControlLeft', 'PRESS KeyZ', 'RELEASE KeyZ', 'RELEASE ControlLeft', 'RELEASE ShiftLeft']);
}
console.log('Touch: taps, drags, press and hold, view gestures, UI pinch and undo taps passed');
