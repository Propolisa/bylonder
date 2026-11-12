// Deform Bones Only on the native rig runtime (skeleton-export.js): the Rigged Character's rig, put on the runtime by an
// Action constraint, exports a skeleton of the bones that skin, those its clip keys and those the page poses, with pose
// controls only for those; the runtime, which solves the whole rig, still poses the kept bones as Main does.
import assert from 'node:assert/strict';
import { NullEngine } from '@babylonjs/core';
import { babylonMatrix } from '../src/blenkernel/main-view.js';
import { blendData, contextStruct } from '../src/python/bpy_rna.js';
import { exportModule } from '../src/io_scene_babylon/js-export.js';
import { openExample } from './open-example.js';
import { writePackage } from './export-package.js';

const FRAMES = [1, 11, 21], TOLERANCE = 1e-3;
const { world, sync } = openExample('rigged-character');
const rig = blendData().objects.get('Rig');
const action = Object.assign(rig.pose.bones.get('chest').constraints.new('ACTION'), { use_eval_time: true, eval_time: 0.5, frame_start: 1, frame_end: 21,
  use_bone_object_action: false });
action.action = rig.animation_data.action;
// Mechanism bones that neither skin nor are keyed, enough to make it a production-sized rig (posedByPage): the skeleton
// drops them.
const C = contextStruct();
C.view_layer.objects.active = rig;
sync.blender.run('object.mode_set', { mode: 'EDIT' });
for (let i = 0; i < 64; i++) {
  const bone = rig.data.edit_bones.new(`MCH-${i}`);
  [bone.head, bone.tail, bone.parent, bone.use_deform] = [[0, 0, i * 0.01], [0, 0.05, i * 0.01], rig.data.edit_bones.get('chest'), false];
}
sync.blender.run('object.mode_set', { mode: 'OBJECT' });
const mechanism = rig.data.bones.get('MCH-0');
sync.blender.tag(sync.objectOf(world.objects.find((n) => n.name === 'Rig')), 2);
rig.data.bones.get('tail').bbone_segments = 1;
sync.view();

const files = await exportModule(world, { deformBonesOnly: true });
const entity = Object.values(JSON.parse(files['scene.ir.json']).entities).find((e) => e.type === 'constraints:POSE');
assert.equal(entity?.implementation, 'native-rig', 'the rig runs on the native runtime');
const written = writePackage(files);
const blend = await (await import(written.url)).load(new NullEngine());
await blend.settled();
blend.playhead.pause();
const skeleton = blend.scene.getSkeletonById('Rig'), skinned = blend.scene.getMeshById(entity.inputs.mesh);
assert.ok(skeleton.bones.length < rig.pose.bones.length, `the skeleton is pruned: ${skeleton.bones.length} of ${rig.pose.bones.length} bones`);
assert.ok(!skeleton.bones.some((b) => b.name === mechanism.name), `${mechanism.name} is dropped`);
assert.ok(!blend.controls().some((c) => c.path.includes(`pose.bones["${mechanism.name}"].location`)), 'a dropped bone has no transform controls');
const frame = blend.controls().find((c) => c.path.endsWith('.frame_current')).path;
const absolute = (bone) => (bone.getParent() ? bone._matrix.multiply(absolute(bone.getParent())) : bone._matrix.multiply(skinned.computeWorldMatrix(true)));
const world_ = (m) => babylonMatrix(Array.from(m)).multiply(babylonMatrix(Array.from(rig.matrix_world)));
let worst = 0;
for (const f of FRAMES) {
  blend.set(frame, f);
  for (let i = 0; i < 2; i++) { blend.scene.render(); await blend.settled(); }
  sync.frameChanged(f);
  for (const bone of skeleton.bones.filter((b) => !b.name.includes('#'))) {
    const ours = absolute(bone).asArray(), theirs = world_(rig.pose.bones.get(bone.name).matrix).asArray();
    const error = Math.max(...theirs.map((v, i) => Math.abs(v - ours[i])));
    assert.ok(error < TOLERANCE, `frame ${f}: ${bone.name} is off by ${error}`);
    worst = Math.max(worst, error);
  }
}
blend.dispose();
written.remove();
console.log(`Export native deform bones: the native rig's skeleton keeps ${skeleton.bones.length} of ${rig.pose.bones.length} bones, posed as Main's within ${worst.toPrecision(2)} at ${FRAMES.length} frames`);
