// The export judges Babylon's skin on what the page plays: the frames of every action the rig's clips come from (armature.js)
// as well as the timeline's
// (tools/blender-reference/skin-check-fixture.py). A tube weighted to a B-Bone, a Corrective Smooth after its Armature,
// passes where the timeline holds the B-Bone straight (nothing to smooth), yet misses where the shipped clip bends it:
// so it stays on the native rig runtime, exact (Snow's head was skinned from the timeline's frames and swelled in his
// dialogue).
import assert from 'node:assert/strict';
import { exportModule } from '../src/io_scene_babylon/js-export.js';
import { subscribeReports } from '../src/windowmanager/wm-reports.js';
import { openExample } from './open-example.js';

const { world, sync } = openExample(new URL('./fixtures/skin-check-rig.blend', import.meta.url).pathname.slice(1));
sync.view();
const reports = [];
subscribeReports((r) => reports.push(r.message));
const route = async (animations) => {
  reports.length = 0;
  const pose = Object.values(JSON.parse((await exportModule(world, { animations }))['scene.ir.json']).entities).find((e) => e.type === 'constraints:POSE');
  return { implementation: pose?.implementation, meshes: Object.keys(pose?.inputs.native?.meshes ?? {}), reports: reports.join(' | ').slice(0, 900) };
};
const both = await route('BOTH');
assert.equal(both.implementation, 'native-rig', `the rig runs on the native runtime: ${both.reports}`);
assert.ok(both.meshes.includes('Tube'), `judged on the clip's frames too, the tube stays on the runtime: ${both.reports}`);
console.log("Export skin check clips: a mesh whose skin only misses in a shipped clip's frames stays on the native rig runtime");
process.exit(0);
