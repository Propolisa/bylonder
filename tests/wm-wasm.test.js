// Blender's window manager in the module: browser input as GHOST events into Main's window, whose 3D View area runs
// Blender's own keymaps (loaded from Blender's keyconfig data) and its modal transform handler. G moves the selected
// object with the mouse until a click confirms, as in Blender. A top orthographic view of 100 pixels per unit.
import assert from 'node:assert/strict';
import { BlenderMain } from '../src/bmesh/bmesh-wasm.js';
import '../src/python/bpy_interface.js';
import { defaultKeymaps } from '../src/windowmanager/keyconfig.js';
import { Window, loadKeyconfig, SPACE_VIEW3D, RGN_TYPE_WINDOW } from '../src/windowmanager/wm-window.js';

const TOP = { viewmat: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -10, 1], winmat: [0.2, 0, 0, 0, 0, 0.2, 0, 0, 0, 0, -0.02, 0, 0, 0, 0, 1], persp: false };
const round = (values) => Array.from(values, (v) => Math.round(v * 1e4) / 1e4 + 0);

const main = new BlenderMain();
const ob = main.add('EMPTY', 'Empty');
main.setBase(ob, { select: true, active: true });
main.evaluate();

const window = new Window(main);
window.size = { width: 1200, height: 1000 };
loadKeyconfig(main.C, defaultKeymaps());
window.allow(['transform.translate']);
const view = window.area(SPACE_VIEW3D);
// The area 200 pixels from the page's left, its window region filling it.
const rect = { x: 200, y: 0, width: 1000, height: 1000 };
view.layout(rect, { [RGN_TYPE_WINDOW]: rect });
view.view3d = TOP;

const move = (px, py) => window.event('pointermove', [px, py]);
const key = (code, k) => [window.event('keydown', [0], { code, key: k, text: k.length === 1 ? k : '' }), window.event('keyup', [0], { code, key: k })][0];
const click = () => [window.event('buttondown', [0]), window.event('buttonup', [0])];

move(700, 500);
const pressed = key('KeyG', 'g');
assert.equal(pressed.modal, true, 'G runs Move modally');
move(800, 500);
move(900, 400);
assert.deepEqual(round(main.transform(ob).location), [2, 1, 0], 'the object follows the mouse');
const [confirmed] = click();
assert.equal(confirmed.modal, false, 'a click confirms');
assert.deepEqual(round(main.transform(ob).location), [2, 1, 0]);
assert.ok(confirmed.redraw.some(([area, type]) => area === view.pointer && type === RGN_TYPE_WINDOW), 'the view is tagged for redrawing');

// Escape cancels: the object goes back.
key('KeyG', 'g');
move(1000, 300);
key('Escape', 'Escape');
assert.deepEqual(round(main.transform(ob).location), [2, 1, 0], 'Escape cancels');

// An operator the page runs itself passes its event on, as do Blender's clicks no keymap uses.
const select = key('KeyA', 'a');
assert.deepEqual(select.unhandled.map(({ type, value }) => [type, value]), [['A', 'PRESS']], 'A selects all in the page');
const [press, release] = click();
assert.deepEqual([...press.unhandled, ...release.unhandled].map(({ type, value, xy }) => [type, value, ...xy]),
  [['LEFTMOUSE', 'PRESS', 1000, 300], ['LEFTMOUSE', 'RELEASE', 1000, 300], ['LEFTMOUSE', 'CLICK', 1000, 300]], 'Blender makes the click');
assert.deepEqual(confirmed.finished, [{ idname: 'TRANSFORM_OT_translate', undo: true }], 'a finished move is an undo step');

console.log('window manager: G, mouse moves and a click move the object through Blender\'s own handlers');
