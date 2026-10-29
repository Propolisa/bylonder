// Blender's window manager in the module: browser input as GHOST events into Main's window, whose 3D View area runs
// Blender's own keymaps (loaded from Blender's keyconfig data) and its modal transform handler. G moves the selected
// object with the mouse until a click confirms, as in Blender. A top orthographic view of 100 pixels per unit. Then a
// Graph Editor area of the same window moves keys the same way.
import assert from 'node:assert/strict';
import { BlenderMain, operatorNames } from '../src/bmesh/bmesh-wasm.js';
import { blendData, pointerStruct, setContextPointer, structFind } from '../src/python/bpy_rna.js';
import '../src/python/bpy_interface.js';
import { defaultKeymaps } from '../src/windowmanager/keyconfig.js';
import { Window, Area, loadKeyconfig, SPACE_VIEW3D, RGN_TYPE_WINDOW } from '../src/windowmanager/wm-window.js';
import { BlenderAnimation, animatedProperty } from '../src/blenkernel/animation/anim-blender.js';
import { AnimArea, SPACE_GRAPH } from '../src/editors/animation/anim-area.js';

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

// An operator the page runs itself passes its event on, as do the events no keymap uses: the press here; the click
// view3d.select's item handles, which uses the release as Blender's would.
const select = key('KeyA', 'a');
assert.deepEqual(select.unhandled.map(({ type, value }) => [type, value]), [['A', 'PRESS']], 'A selects all in the page');
const [press, release] = click();
assert.deepEqual([...press.unhandled, ...release.unhandled].map(({ type, value, xy }) => [type, value, ...xy]),
  [['LEFTMOUSE', 'PRESS', 1000, 300], ['LEFTMOUSE', 'CLICK', 1000, 300]], 'Blender makes the click');
assert.deepEqual(confirmed.finished, [{ idname: 'TRANSFORM_OT_translate', undo: true }], 'a finished move is an undo step');

// A popup menu an operator builds (Move to Collection) polls its items in the context it was built in.
const moveTo = main.invoke('object.move_to_collection', {}, { type: 'M', value: 'PRESS', x: 10, y: 10 }).popup;
assert.equal(moveTo?.title, 'Move to Collection');
assert.ok(moveTo.text.includes('New Collection') && !moveTo.text.includes('"disabled":true'), 'its items poll');
const uid = Number(moveTo.text.match(/collection_uid\D+(\d+)/)[1]);
const newCollection = main.invoke('object.move_to_collection', { collection_uid: uid, is_new: true }, { type: 'M', value: 'PRESS' });
const nameButton = JSON.parse(newCollection.popup.text).layout.children.flatMap(function buttons(node) { return [node, ...(node.children ?? []).flatMap(buttons)]; })
  .find((node) => node.type === 'TEXT');
assert.equal(nameButton.rna.index, -1, "the name field's property is no array, so the page sets it whole");
main.finishPopup(newCollection.dialog, false);

// The view Object Mode's operators act in (main.view) is an area of the window's screen too, whose gizmo map stands in
// for the page's: Blender's event handling reads it after a press it checked for a drag (Ctrl, then P's click).
main.view = { ...TOP, winx: 1000, winy: 1000 };
window.allow(['object.parent_set']);
window.event('keydown', [0], { code: 'ControlLeft', key: 'Control' });
window.event('keydown', [0], { code: 'KeyP', key: 'p', text: 'p' });
const released = window.event('keyup', [0], { code: 'KeyP', key: 'p' });
window.event('keyup', [0], { code: 'ControlLeft', key: 'Control' });
assert.ok(released.unhandled.some(({ type, value }) => type === 'P' && value === 'CLICK'), 'the release of Ctrl P is handled');
window.allow(['transform.translate']);

// The Graph Editor below the 3D View, 10 pixels a frame: G moves the selected keys 10 frames for 100 pixels.
const anim = new BlenderAnimation(main);
anim.setTime({ frame: 1, start: 1, end: 250, previewStart: 0, previewEnd: 0, preview: false, fps: 24 });
const { type, subtype } = animatedProperty('Object', 'location');
const fc = anim.fcurve(ob, 'location', 0, { group: 'Object Transforms', type, subtype });
anim.insert(fc, 1, 0);
anim.insert(fc, 11, 1);
fc.keys = fc.keys.map((k) => ({ ...k, select: [true, true, true] }));
const graph = new AnimArea(main, SPACE_GRAPH);
const top = { x: 200, y: 0, width: 1000, height: 500 }, bottom = { x: 200, y: 500, width: 1000, height: 500 };
view.layout(top, { [RGN_TYPE_WINDOW]: top });
Area.prototype.layout.call({ window, pointer: graph.pointer }, bottom, { [RGN_TYPE_WINDOW]: bottom });
graph.v2d().cur = { xmin: 0, xmax: 100, ymin: -5, ymax: 5 };
move(400, 750);
const gg = key('KeyG', 'g');
assert.equal(gg.modal, true, 'G in the Graph Editor runs Move modally');
move(500, 750);
click();
assert.deepEqual(anim.fcurves(ob)[0].keys.map((k) => Math.round(k.co[0])), [11, 21], 'the keys moved 10 frames');
graph.dispose();

// A Text Editor in its place: Alt S matches text.save, an operator the page runs, so the event goes to the page and stops
// there, as Blender's handled item would, instead of falling through to text.insert, which would type the letter.
const SPACE_TEXT = 9;
setContextPointer(main.C);
window.allow(operatorNames().filter((idname) => idname.startsWith('text.') && idname !== 'text.save'));
const textArea = window.area(SPACE_TEXT);
textArea.layout(bottom, { [RGN_TYPE_WINDOW]: bottom });
const text = blendData().texts.new('Text');
pointerStruct(structFind('Area'), 0, textArea.pointer).spaces.active.text = text;
move(400, 750);
key('KeyA', 'a');
window.event('keydown', [0], { code: 'AltLeft', key: 'Alt' });
const save = window.event('keydown', [0], { code: 'KeyS', key: 's', text: 's' });
window.event('keyup', [0], { code: 'KeyS', key: 's' });
window.event('keyup', [0], { code: 'AltLeft', key: 'Alt' });
assert.equal(text.as_string(), 'a', 'Alt S types nothing');
assert.deepEqual(save.unhandled.map(({ type, value, modifier }) => [type, value, modifier]), [['S', 'PRESS', 4]], 'Alt S goes to the page');
textArea.free();

console.log('window manager: G, mouse moves and a click move an object in a 3D View and keys in a Graph Editor through Blender\'s own handlers');
