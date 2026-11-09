// The page's scheduler at load (src/io_scene_babylon/runtime/scheduler.js): an entity that reads nothing runs once only
// when the package bakes none of it (curves); a baked one (a Geometry Nodes modifier's mesh in scene.bin) stays as
// baked, as the app evaluated it.
import assert from 'node:assert/strict';
import { NullEngine, Scene } from '@babylonjs/core';
import { createScheduler } from '../src/io_scene_babylon/runtime/scheduler.js';
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
console.log('Scheduler at load: what the package bakes stays baked, curves run once');
