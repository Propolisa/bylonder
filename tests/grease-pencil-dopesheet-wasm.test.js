// The Dope Sheet's Grease Pencil mode on the Bouncing Ball example (Blender's space_action code in the module): its
// layers are channels with their keys, Select All and a time translate move the Ball layer's keys, and Insert Blank
// Keyframe adds one.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { BlenderMain, datafiles, newOperator } from '../src/bmesh/bmesh-wasm.js';
import { contextStruct, setContextPointer } from '../src/python/bpy_rna.js';
import '../src/python/bpy_interface.js';
import { AnimArea, SPACE_ACTION, RGN_TYPE_WINDOW, ACTION_MODES, OPERATOR_FINISHED } from '../src/editors/animation/anim-area.js';

await datafiles;
const main = new BlenderMain();
main.readBlend(await readFile(new URL('../examples/grease-pencil/grease-pencil.blend', import.meta.url)));
main.evaluate();
setContextPointer(main.C);

const area = new AnimArea(main, SPACE_ACTION);
area.subtype = ACTION_MODES.GPENCIL;
area.layout(RGN_TYPE_WINDOW, 0, 0, 800, 400);
const ball = () => area.channels().findIndex((channel) => channel.name === 'Ball');
const frames = () => area.keys(ball(), -100, 100).map((key) => key.frame);
assert.deepEqual(area.channels().map((channel) => channel.name).filter((name) => ['Ground', 'Shadow', 'Ball'].includes(name)).sort(), ['Ball', 'Ground', 'Shadow'],
  'each layer is a channel');
assert.deepEqual(frames(), Array.from({ length: 12 }, (_, i) => 1 + 2 * i), "the Ball layer's keys, drawn on twos");

const run = (idname, props) => area.run(newOperator(idname, props), RGN_TYPE_WINDOW) & OPERATOR_FINISHED;
assert.ok(run('action.select_all', { action: 'SELECT' }), 'Select All');
assert.ok(area.keys(ball(), -100, 100).every((key) => key.select), 'every key is selected');
assert.ok(run('transform.transform', { mode: 'TIME_TRANSLATE', value: [2, 0, 0, 0] }), 'Move');
assert.deepEqual(frames(), Array.from({ length: 12 }, (_, i) => 3 + 2 * i), 'the keys moved two frames');

const ob = contextStruct().object;
ob.data.layers.active = ob.data.layers.get('Ball');
main.frame = 30;
assert.ok(main.run('grease_pencil.insert_blank_frame', {}).status & OPERATOR_FINISHED, 'Insert Blank Keyframe');
assert.ok(frames().includes(30), 'a blank key at the current frame');
area.dispose();
console.log(`grease pencil dope sheet: the layers' channels and keys, Select All, a two-frame move and Insert Blank Keyframe`);
