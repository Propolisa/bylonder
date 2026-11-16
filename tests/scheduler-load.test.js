// The page's scheduler at load (src/io_scene_babylon/runtime/scheduler.js): an entity that reads nothing runs once only
// when the package bakes none of it (curves); a baked one (a Geometry Nodes modifier's mesh in scene.bin) stays as
// baked, as the app evaluated it. An implementation loaded at once that fails to load is no unhandled error.
import assert from 'node:assert/strict';
import { NullEngine, Scene } from '@babylonjs/core';
import { createScheduler, EVALUATORS } from '../src/io_scene_babylon/runtime/scheduler.js';
import { packKeys } from '../src/io_scene_babylon/runtime/fcurve-evaluator.js';
import { register, unregister } from '../src/io_scene_babylon/runtime/units.js';

const ran = [];
const entity = (type, implementation) => ({ type, implementation, inputs: {}, outputs: {} });
const ir = { ids: {}, graphs: {}, order: ['towers', 'hair'],
  entities: { towers: entity('modifier:NODES', 'geometry-nodes'), hair: entity('curves:hair', 'curves') } };
for (const key of Object.keys(ir.entities)) register(ir.entities[key].type, { run: () => (ran.push(key), {}) });
const scene = new Scene(new NullEngine());
const scheduler = createScheduler(ir, { scene, root: '', ir, buffers: [], controls: { get: () => undefined, write: () => {}, frame: () => 1 } });
await scheduler.settled();
assert.deepEqual(ran, ['hair'], 'the curves run once; the baked modifier does not');
scheduler.dispose();
for (const { type } of Object.values(ir.entities)) unregister(type);

// What reads the frame loads its implementation at once; a load that fails (the scene disposed and its files gone)
// rejects nothing unhandled.
const fcurve = EVALUATORS.fcurve;
EVALUATORS.fcurve = () => Promise.reject(new Error('gone'));
const timed = { ...ir, order: ['spin'], entities: { spin: { type: 'fcurve:rotation', implementation: 'fcurve',
  inputs: { frame: { property: 'scenes["Scene"].frame_current' } }, outputs: {} } } };
createScheduler(timed, { scene, root: '', ir: timed, buffers: [], controls: { get: () => undefined, write: () => {}, frame: () => 1 } }).dispose();
await new Promise((resolve) => setTimeout(resolve, 10));
EVALUATORS.fcurve = fcurve;

// An F-Curve that gives one value at every frame runs once, not each frame; a patch that replaces it runs it again.
const flat = (values) => ({ type: 'animation:FCURVE', implementation: 'fcurve', outputs: { value: { property: 'objects["Cube"].location[0]' } },
  inputs: { frame: { property: 'scenes["Scene"].frame_current' }, curve: { extrapolation: 'CONSTANT', keyframes: packKeys(values.map((v, i) => ({ co: [i * 10 + 1, v], interpolation: 'LINEAR' }))) } } });
const curves = { ...ir, order: ['x'], entities: { x: flat([2, 2]) } };
let at = 1, wrote = 0;
const playing = createScheduler(curves, { scene, root: '', ir: curves, buffers: [], controls: { get: () => undefined, write: () => wrote++, frame: () => at } });
await playing.settled();
const play = async (frames) => { for (let i = 0; i < frames; i++) { at++; scene.onAfterAnimationsObservable.notifyObservers(scene); await playing.settled(); } };
await play(5);
const once = wrote;
await play(5);
assert.equal(wrote - once, 5, 'a flat curve is not evaluated again: only the after-animation check writes it back');
playing.replace({ x: flat([0, 4]) }, [], () => false);
await playing.settled();
wrote = 0;
await play(3);
assert.equal(wrote, 6, 'the curve a patch made slope runs at each frame again');
playing.dispose();
console.log('Scheduler: what the package bakes stays baked, curves run once, a failed load is no unhandled error, and a flat F-Curve runs once until a patch changes it');
