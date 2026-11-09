// The page's scheduler at load (src/io_scene_babylon/runtime/scheduler.js): an entity that reads nothing runs once only
// when the package bakes none of it (curves); a baked one (a Geometry Nodes modifier's mesh in scene.bin) stays as
// baked, as the app evaluated it. An implementation loaded at once that fails to load is no unhandled error.
import assert from 'node:assert/strict';
import { NullEngine, Scene } from '@babylonjs/core';
import { createScheduler, EVALUATORS } from '../src/io_scene_babylon/runtime/scheduler.js';
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
console.log('Scheduler at load: what the package bakes stays baked, curves run once, and a failed load is no unhandled error');
