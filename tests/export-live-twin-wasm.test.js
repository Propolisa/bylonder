// Live Modifiers: of two settings in one DNA field, the animated one is the page's control, which the animation sets
// (Koi Pond's Tail Swing animates a Simple Deform's `angle`, the same field as its `factor`).
import assert from 'node:assert/strict';
import { openExample } from './open-example.js';
import { exportModule } from '../src/io_scene_babylon/js-export.js';

const { world, sync } = openExample('vertex-and-weight-paint');
sync.view();
const properties = Object.keys(JSON.parse((await exportModule(world, { live: true }))['scene.ir.json']).properties);
const swing = 'objects["Kohaku"].modifiers["Tail Swing"]';
assert.ok(properties.includes(`${swing}.angle`), 'the animated angle is a control');
assert.ok(!properties.includes(`${swing}.factor`), 'its twin factor is not');
console.log("Live modifiers: an animated setting's DNA twin leaves the controls to it");
process.exit(0);
