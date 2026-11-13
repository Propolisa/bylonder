// An exported page's morphed mesh compiles its material once: every morph target counts as an influencer, at zero too
// (Babylon's optimizeInfluencers off), so a shape key set to 0 and back does not change the count the shader is
// compiled for (NUM_MORPH_INFLUENCERS) and make the mesh wait for a new compile (Snow's pants flipped between 1 and 3
// influencers while walking, each flip a compile of seconds).
import assert from 'node:assert/strict';
import { NullEngine } from '@babylonjs/core';
import { exportModule } from '../src/io_scene_babylon/js-export.js';
import { openExample } from './open-example.js';
import { writePackage } from './export-package.js';

const { world, sync } = openExample('rigged-character');
sync.view();
const written = writePackage(await exportModule(world));
const blend = await (await import(written.url)).load(new NullEngine());
await blend.settled();
blend.playhead.pause();
const manager = blend.scene.getMeshByName('Body').morphTargetManager, keys = blend.controls().filter((c) => /^shape_keys\[.*\]\.key_blocks\[.*\]\.value$/.test(c.path));
assert.ok(manager?.numTargets > 1 && keys.length, 'the body has shape keys');
for (let step = 0; step < 100; step++) {
  keys.forEach((key, i) => blend.set(key.path, (step + i) % 3 === 0 ? 0 : 0.5));
  blend.scene.render();
  assert.equal(manager.numInfluencers, manager.numTargets, `step ${step}: every target counts, ${manager.numInfluencers} of ${manager.numTargets}`);
}
blend.dispose();
written.remove();
console.log('Export morph compiles once: a morphed mesh keeps its influencer count over 100 steps of keys going to 0 and back');
process.exit(0);
