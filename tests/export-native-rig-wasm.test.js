// The JavaScript export's bone constraints on the native rig runtime (runtime/native-solve.js, the clean room's
// babylon-blender-rig, MIT): the Rigged Character's rig given an Action constraint, which Blender's constraint kernels
// do not run, is posed in the page by the runtime from its bylonder-rig description (rig-description.js) at frames of
// its animation as Main poses it, nothing sampled.
import assert from 'node:assert/strict';
import { NullEngine } from '@babylonjs/core';
import { babylonMatrix } from '../src/blenkernel/main-view.js';
import { blendData } from '../src/python/bpy_rna.js';
import { exportModule } from '../src/io_scene_babylon/js-export.js';
import { openExample } from './open-example.js';
import { writePackage } from './export-package.js';

const FRAMES = [1, 8, 15, 21];
// The IK solver's tolerance, as a matrix's entries.
const TOLERANCE = 1e-3;

const { world, sync } = openExample('rigged-character');
const rig = blendData().objects.get('Rig');
// The rig's own action, played on the spine by the chest's Action constraint at a fixed time.
const action = Object.assign(rig.pose.bones.get('chest').constraints.new('ACTION'), { use_eval_time: true, eval_time: 0.5, frame_start: 1, frame_end: 21,
  use_bone_object_action: false });
action.action = rig.animation_data.action;
sync.blender.tag(sync.objectOf(world.objects.find((n) => n.name === 'Rig')), 2);
sync.view();
const files = await exportModule(world);
const entity = Object.values(JSON.parse(files['scene.ir.json']).entities).find((e) => e.type === 'constraints:POSE');
assert.equal(entity?.implementation, 'native-rig', 'a rig with an Action constraint runs on the native runtime');
const groups = JSON.parse(/const ANIMATION_GROUPS = (.*);\n/.exec(files['scene.js'])[1]);
assert.deepEqual(groups.flatMap((g) => g.targetedAnimations).filter((t) => /^Rig /.test(t.targetId) && !t.targetId.includes('#') && t.animation.keys.length > 1).map((t) => t.targetId), [],
  'no bone is sampled');

const written = writePackage(files);
const blend = await (await import(written.url)).load(new NullEngine());
await blend.settled();
blend.playhead.pause();
const skeleton = blend.scene.getSkeletonById('Rig'), body = blend.scene.getMeshById(entity.inputs.mesh);
const frame = blend.controls().find((c) => c.path.endsWith('.frame_current')).path;
const absolute = (bone) => (bone.getParent() ? bone._matrix.multiply(absolute(bone.getParent())) : bone._matrix.multiply(body.computeWorldMatrix(true)));
const world_ = (m) => babylonMatrix(Array.from(m)).multiply(babylonMatrix(Array.from(rig.matrix_world)));
for (const f of FRAMES) {
  blend.set(frame, f);
  for (let i = 0; i < 2; i++) { blend.scene.render(); await blend.settled(); }
  sync.frameChanged(f);
  for (const pb of rig.pose.bones) {
    const ours = absolute(skeleton.bones.find((b) => b.name === pb.name)), theirs = world_(pb.matrix);
    const error = Math.max(...theirs.asArray().map((v, i) => Math.abs(v - ours.asArray()[i])));
    assert.ok(error < TOLERANCE, `frame ${f}: ${pb.name} is off by ${error}`);
  }
}
blend.dispose();
written.remove();
console.log(`Export native rig: a rig with an Action constraint takes Main's pose in the page at ${FRAMES.length} frames on the native runtime`);
