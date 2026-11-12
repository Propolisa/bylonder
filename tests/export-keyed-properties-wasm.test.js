// An integer and a boolean custom property keyed in a rig's action (tests/fixtures/keyed-properties.blend, from
// tools/blender-reference/keyed-properties-fixture.py, as a rig's IK parent switch and a toggle) play in the page as
// Blender evaluates them: run on the F-Curve unit, the integer rounded between its keys (0.8 is 1) and held to its hard
// maximum (3, where its keys reach 4), the boolean switched at its key. Before, neither ran: the page held their
// defaults. Its clip, played, sets them too, as the clip plays, held to the same limits.
import assert from 'node:assert/strict';
import { NullEngine } from '@babylonjs/core';
import { blendData } from '../src/python/bpy_rna.js';
import { exportModule } from '../src/io_scene_babylon/js-export.js';
import { openExample } from './open-example.js';
import { writePackage } from './export-package.js';

// Blender's values at frames 1 to 12 (reference Blender 5.2).
const IK_PARENTS = [0, 0, 1, 1, 2, 2, 2, 3, 3, 3, 3, 3], TOGGLE = [0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1];
const INT = 'objects["Rig"].pose.bones["Properties"]["ik_parents"]', BOOL = 'objects["Rig"]["toggle"]';

const { world, sync } = openExample(new URL('./fixtures/keyed-properties.blend', import.meta.url));
const rig = blendData().objects.get('Rig');
sync.view();
const main = IK_PARENTS.map((_, i) => { sync.frameChanged(i + 1); return [rig.pose.bones.get('Properties').get('ik_parents'), Number(rig.get('toggle'))]; });
assert.deepEqual(main.map(([v]) => v), IK_PARENTS, "Main evaluates the integer as Blender");
assert.deepEqual(main.map(([, v]) => v), TOGGLE, "and the boolean");

const files = await exportModule(world, { animations: 'BOTH' });
const entities = JSON.parse(files['scene.ir.json']).entities;
for (const path of [INT, BOOL]) assert.equal(Object.values(entities).find((e) => e.outputs?.value?.property === path)?.implementation, 'fcurve', `${path} runs on the F-Curve unit`);

const written = writePackage(files);
const blend = await (await import(written.url)).load(new NullEngine());
await blend.settled();
blend.playhead.pause();
const frame = blend.controls().find((c) => c.path.endsWith('.frame_current')).path;
for (const [i, expected] of IK_PARENTS.entries()) {
  blend.set(frame, i + 1);
  blend.scene.render();
  await blend.settled();
  assert.equal(blend.get(INT), expected, `frame ${i + 1}: ik_parents`);
  assert.equal(Number(blend.get(BOOL)), TOGGLE[i], `frame ${i + 1}: toggle`);
}
// Its clip, played (blend.play) over the paused timeline: the page sets them as the clip plays, from the clip's samples,
// held to the integer's hard maximum.
const { group } = blend.clips()[0], start = group.metadata.bylonder.frame_start;
blend.play(group.name).pause();
for (const i of IK_PARENTS.keys()) {
  if (i + 1 - start > group.to) continue;
  group.goToFrame(i + 1 - start);
  blend.scene.render();
  await blend.settled();
  assert.equal(blend.get(INT), IK_PARENTS[i], `clip frame ${i + 1}: ik_parents`);
  assert.equal(blend.get(BOOL), !!TOGGLE[i], `clip frame ${i + 1}: toggle`);
}
blend.dispose();
written.remove();
console.log('Export keyed properties: an integer and a boolean custom property keyed in an action play in the page and its clip as Blender evaluates them');
process.exit(0);
