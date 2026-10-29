// The browser's input through Blender's window (windowmanager/wm-event-system.js with a window of wm-window.js): DOM
// events become Blender's, a modal transform runs on Blender's handlers, and what Blender leaves unhandled reaches the
// page's keymaps with Blender's values (a press, then Blender's click).
import assert from 'node:assert/strict';
import { BlenderMain } from '../src/bmesh/bmesh-wasm.js';
import '../src/python/bpy_interface.js';
import { defaultKeymaps } from '../src/windowmanager/keyconfig.js';
import { Window, loadKeyconfig, SPACE_VIEW3D, RGN_TYPE_WINDOW } from '../src/windowmanager/wm-window.js';
import { createEventSystem } from '../src/windowmanager/wm-event-system.js';

const listeners = {};
globalThis.addEventListener = (name, fn) => { listeners[name] = fn; };
globalThis.removeEventListener = () => {};
const dom = (name, fields) => listeners[name]({ isTrusted: true, preventDefault() {}, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, ...fields });

const main = new BlenderMain();
const ob = main.add('EMPTY', 'Empty');
main.setBase(ob, { select: true, active: true });
main.evaluate();
const window = new Window(main);
window.size = { width: 1000, height: 1000 };
loadKeyconfig(main.C, defaultKeymaps());
window.allow(['transform.translate']);
const area = window.area(SPACE_VIEW3D), rect = { x: 0, y: 0, width: 1000, height: 1000 };
area.layout(rect, { [RGN_TYPE_WINDOW]: rect });
area.view3d = { viewmat: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -10, 1], winmat: [0.2, 0, 0, 0, 0, 0.2, 0, 0, 0, 0, -0.02, 0, 0, 0, 0, 1], persp: false };

const view = { id: 'view' }, page = [];
const wm = createEventSystem({
  layers: () => [(event) => { page.push(`${event.type} ${event.value}`); return event.type === 'a'; }],
  viewAt: () => view,
  blender: { takes: () => true, send: (kind, data, strings) => window.event(kind, data, strings), pressHandled: () => window.pressHandled() },
});

const key = (code, k) => { dom('keydown', { code, key: k }); dom('keyup', { code, key: k }); };
dom('pointermove', { clientX: 500, clientY: 500, target: view });
key('KeyG', 'g');
assert.ok(wm.modal?.blender, 'G runs a modal operator of Blender\'s');
dom('pointermove', { clientX: 600, clientY: 500, target: view });
dom('pointerdown', { button: 0, clientX: 600, clientY: 500, target: view });
dom('pointerup', { button: 0, clientX: 600, clientY: 500, target: view });
assert.equal(wm.modal, null, 'the click confirms');
assert.deepEqual(Array.from(main.transform(ob).location, (v) => Math.round(v * 1e4) / 1e4), [1, 0, 0]);
assert.deepEqual(page, [], 'Blender handled all of it');

key('KeyA', 'a');
dom('pointerdown', { button: 0, clientX: 600, clientY: 500, target: view });
dom('pointerup', { button: 0, clientX: 600, clientY: 500, target: view });
assert.deepEqual(page.filter((e) => !e.endsWith('RELEASE')), ['a PRESS', 'leftmouse PRESS', 'leftmouse CLICK'],
  'the page gets what Blender leaves: no click of a press it used, Blender\'s click of one it did not');

console.log('window manager events: DOM input through Blender\'s window, the rest to the page\'s keymaps');
