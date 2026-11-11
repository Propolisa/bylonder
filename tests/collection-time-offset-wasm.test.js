// A collection's Time Offset in an exported package (Bylonder's own control, docs/ir.md Collections): the NLA example's
// box in Inner, inside Outer, and also in Late, after them in the outliner. Offsets add up from the scene collection
// down; an object in two collections takes the first in the outliner's order. The box, offset by Outer's and Inner's,
// shows at each frame where Main puts it that many frames earlier, wrapped into the range as playback loops.
import assert from 'node:assert/strict';
import { NullEngine } from '@babylonjs/core';
import { openExample } from './open-example.js';
import { exportModule } from '../src/io_scene_babylon/js-export.js';
import { writePackage } from './export-package.js';
import { blendData } from '../src/python/bpy_rna.js';
import { babylonMatrix } from '../src/blenkernel/main-view.js';

const { world, sync } = openExample('nla');
const data = blendData(), scene = data.scenes[0], box = data.objects.get('Box');
const outer = data.collections.new('Outer'), inner = data.collections.new('Inner'), late = data.collections.new('Late');
scene.collection.children.link(outer);
outer.children.link(inner);
scene.collection.children.link(late);
inner.objects.link(box);
late.objects.link(box);
scene.collection.objects.unlink(box);
sync.view();

const written = writePackage(await exportModule(world));
const { loadBlendScene } = await import(new URL('bylonder/blend-scene.js', written.url).href);
const blend = await loadBlendScene(new NullEngine(), written.url);
const offset = (name) => `collections["${name}"].bylonder.time_offset`;
assert.equal(blend.get(offset('Inner')), 0, 'each collection has a Time Offset, 0 as exported');
blend.set(offset('Outer'), 4);
blend.set(offset('Inner'), 6);
blend.set(offset('Late'), 100);
assert.equal(blend.timeOffsetOf('Box'), 10, "Outer's and Inner's added up; Late, later in the outliner, does not count");

const { frame_start: start, frame_end: end } = blend.ir.scene.time;
blend.playhead.pause();
for (const frame of [12, 40, 3]) {
  blend.playhead.seek(frame);
  blend.scene.render();
  await blend.settled();
  const shown = frame - 10 >= start ? frame - 10 : frame - 10 + end - start + 1;
  sync.frameChanged(shown);
  const drawn = blend.nodeOf('OB:Box').computeWorldMatrix(true).asArray(), main = babylonMatrix(sync.blender.transform(sync.objectOf(world.objects.find((n) => n.name === 'Box'))).matrix_world).asArray();
  assert.ok(drawn.every((v, i) => Math.abs(v - main[i]) < 1e-4), `at frame ${frame} the box shows Main's frame ${shown}: ${drawn.map((v) => v.toFixed(3))}, Main ${main.map((v) => v.toFixed(3))}`);
}
blend.dispose();
written.remove();
console.log("collection time offset: offsets add up through nested collections, the first collection in the outliner's order counts, and the box plays that many frames later");
