// tags: export, physics
// Rigid bodies (Physics properties > Rigid Body) on Rock Hard Café: the IR carries each object's rigid_body settings.
// Without a game that runs physics the page plays Blender's own simulation, baked as the scene's animation (the cup
// prefab, which starts inside the ground, is pushed out of it); with one (`physics: 'havok'` in src/game.js), the game
// simulates them, so no rigid body's motion is baked.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { NullEngine } from '@babylonjs/core';
import { exportModule } from '../src/io_scene_babylon/js-export.js';
import { writePackage } from './export-package.js';
import { openExample } from './open-example.js';

const { world, sync } = openExample('rock-hard-cafe');
sync.view();
const root = new URL('../examples/rock-hard-cafe/', import.meta.url);
const project = { files: ['package.json', 'src/game.js'], read: (path) => readFile(new URL(path, root)) };
const moving = async (options) => {
  const files = await exportModule(world, { animations: 'BOTH', ...options }), written = writePackage(files);
  const blend = await (await import(written.url)).load(new NullEngine());
  const targets = new Set(blend.scene.animationGroups.flatMap((g) => g.targetedAnimations.map((t) => t.target?.name)));
  blend.dispose();
  written.remove();
  return { ir: JSON.parse(files['scene.ir.json']), baked: (name) => targets.has(name) };
};
const plain = await moving({});
assert.deepEqual(Object.fromEntries(['type', 'collision_shape', 'mass'].map((k) => [k, plain.ir.ids['OB:Cup'].data.rigid_body[k]])), { type: undefined, collision_shape: 'CYLINDER', mass: 0.3 },
  "the cup's rigid body: Active (Blender's default, left out), a cylinder of 0.3 kg");
assert.equal(plain.ir.ids['OB:Rock'].data.rigid_body.kinematic, true, 'the rock is Animated: its code moves it');
assert.ok(plain.baked('Cup'), "without game physics, Blender's simulation of the cup is baked");
const simulated = await moving({ project });
assert.ok(!simulated.baked('Cup'), 'with game physics, the game simulates the cup: nothing baked');
console.log('Export rigid bodies: the IR carries them; Blender\'s simulation is baked unless the game runs physics');
process.exit(0);
