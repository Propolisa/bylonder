// Control writes place a bone once, not once per float (runtime/blend-scene.js): a rig's live outputs are written a
// float at a time, and each bone is posed when what its writers wrote is next read (by an entity that reads the nodes,
// or by drawing), 3 times a frame for Rock Hard Café's barista, played headless, where it was 21.
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { Bone } from '@babylonjs/core';

register('./fixtures/example-loader.mjs', import.meta.url);
const { run } = await import('./game-test.js');

const game = await run('examples/rock-hard-cafe', { seed: 1 });
const scene = game.blend.scene;
// Bones posed between the end of Babylon's animation and the end of the frame: the controls' placements.
const { get, set } = Object.getOwnPropertyDescriptor(Bone.prototype, '_matrix');
let counting = false;
const placed = new Map();
Object.defineProperty(Bone.prototype, '_matrix', { get, set(value) { if (counting) placed.set(this, (placed.get(this) ?? 0) + 1); set.call(this, value); }, configurable: true });
scene.onAfterAnimationsObservable.add(() => { counting = true; }, undefined, true);
scene.onAfterRenderObservable.add(() => { counting = false; });
await game.step({ seconds: 1 });
placed.clear();
await game.step({ seconds: 0.5 });
const frames = 30, most = Math.max(0, ...placed.values()) / frames;
assert.ok(placed.size > 10, `the barista's rig places its bones: ${placed.size}`);
assert.ok(most <= 3, `each bone is placed once for each run of what writes or reads it: ${most.toFixed(2)}`);
assert.deepEqual(game.errors, []);
game.dispose();
console.log(`BlendScene placements: ${placed.size} bones, each placed ${most.toFixed(2)} times a frame`);
process.exit(0);
