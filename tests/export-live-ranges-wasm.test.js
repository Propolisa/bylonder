// Live Modifiers: a modifier setting's control carries the UI range Blender's RNA gives it, as the app's slider spans
// (Koi Pond's Tail Swing limits, 0 to 1).
import assert from 'node:assert/strict';
import { openExample } from './open-example.js';
import { exportModule } from '../src/io_scene_babylon/js-export.js';

const { world, sync } = openExample('vertex-and-weight-paint');
sync.view();
const { properties } = JSON.parse((await exportModule(world, { live: true }))['scene.ir.json']);
const limit = properties['objects["Showa"].modifiers["Tail Swing"].limits[1]'];
assert.deepEqual([limit.soft_min, limit.soft_max], [0, 1], 'the limit spans 0 to 1');
console.log('Live modifiers: a setting keeps its RNA range');
process.exit(0);
