// A patch of a clip a page plays (BlendScene.patch, runtime/clips.js refresh): after a key of the Hop action moves in the
// app, the patch makes the clip's group again and the page plays on in it from the frame it was at, with no reload, as
// the new export plays the clip from that frame.
import assert from 'node:assert/strict';
import { NullEngine } from '@babylonjs/core';
import { blendData } from '../src/python/bpy_rna.js';
import { exportPackage } from '../src/io_scene_babylon/js-export.js';
import { actionFCurves } from '../src/io_scene_babylon/ir-export.js';
import { packageState, tablesPatch } from '../src/io_scene_babylon/scene-patch.js';
import { writePackage } from './export-package.js';
import { openExample } from './open-example.js';

const { world, sync } = openExample('nla');
sync.view();
const options = { animations: 'CLIPS' };
const exported = async () => { const made = await exportPackage(world, options); return { made, state: packageState(made) }; };
const loaded = async ({ made }) => {
  const written = writePackage(made.files), blend = await (await import(written.url)).load(new NullEngine());
  await blend.settled();
  blend.scene.useConstantAnimationDeltaTime = true;
  return { blend, remove: written.remove };
};
const box = (blend) => blend.scene.getMeshByName('Box').position.asArray().map((v) => +v.toFixed(4)).join();

const first = await exported(), page = await loaded(first);
page.blend.play('Hop');
for (let i = 0; i < 5; i++) page.blend.scene.render();
const before = page.blend.clips().find((c) => c.name === 'Hop').group, frame = before.animatables[0].masterFrame;

const hop = actionFCurves({ action: blendData().actions.get('Hop') }).find((fc) => fc.data_path === 'location' && fc.array_index === 2).keyframe_points;
for (const key of hop) key.co[1] += 0.5;
sync.view();
const second = await exported(), patch = tablesPatch(first.state, second.state);
assert.ok(patch.tables.animations, `the patch carries Hop's keys: ${Object.keys(patch.tables).join(', ')}`);
assert.equal(await page.blend.patch({ ...patch, buffers: second.made.buffers }), page.blend, 'and applies, with no reload');

const after = page.blend.clips().find((c) => c.name === 'Hop').group;
assert.notEqual(after, before, 'the clip plays in its new group');
assert.ok(after.isPlaying && Math.abs(after.animatables[0].masterFrame - frame) < 1e-6, 'on from the frame it was at');

const fresh = await loaded(second);
const freshHop = fresh.blend.play('Hop');
freshHop.goToFrame(frame);
for (let i = 0; i < 4; i++) {
  page.blend.scene.render();
  fresh.blend.scene.render();
  assert.equal(box(page.blend), box(fresh.blend), `frame ${i} after the patch plays the new keys`);
}
page.remove();
fresh.remove();
console.log('Export patch clips: an edited clip reaches the page playing it, which plays on in the new keys from its frame');
process.exit(0);
