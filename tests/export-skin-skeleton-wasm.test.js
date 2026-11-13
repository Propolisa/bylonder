// A rig's two skeletons in a package (skeleton-export.js skinSkeletons): the Rigged Character's rig, on the native runtime
// by an Action constraint, keeps every bone in its rig skeleton, which the clips, the character, the solve and its
// controls read and write; its body skins to a skin skeleton of only the bones it weights and those above them, copied
// from the rig each frame (runtime/skin-skeleton.js), so a mechanism bone costs the skin nothing and a bone a character
// uses (a control playing a role's bone, a target a role's constraint reads) is never lost. Every page module finds
// the rig, never the skin, and both are posed as Main's.
import assert from 'node:assert/strict';
import { NullEngine } from '@babylonjs/core';
import { babylonMatrix } from '../src/blenkernel/main-view.js';
import { blendData, contextStruct } from '../src/python/bpy_rna.js';
import { exportModule } from '../src/io_scene_babylon/js-export.js';
import { findRoles } from '../src/io_scene_babylon/runtime/character/roles.js';
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
// A control that plays a role's bone (an FK hand) and a target a role's constraint reads (where the hand points), neither
// deforming nor keyed: a character on the page writes and reads them, so they stay.
for (const name of ['FK-hand.L', 'MCH-look']) Object.assign(rig.data.edit_bones.new(name), { head: [0, -0.5, 1], tail: [0, -0.55, 1], use_deform: false });
sync.blender.run('object.mode_set', { mode: 'OBJECT' });
Object.assign(rig.pose.bones.get('hand.L').constraints.new('DAMPED_TRACK'), { target: rig, subtarget: 'MCH-look', influence: 0 });
const mechanism = rig.data.bones.get('MCH-0');
sync.blender.tag(sync.objectOf(world.objects.find((n) => n.name === 'Rig')), 2);
rig.data.bones.get('tail').bbone_segments = 1;
sync.view();

const files = await exportModule(world);
const ir = JSON.parse(files['scene.ir.json']), entity = Object.values(ir.entities).find((e) => e.type === 'constraints:POSE');
assert.equal(entity?.implementation, 'native-rig', 'the rig runs on the native runtime');
const written = writePackage(files);
const blend = await (await import(written.url)).load(new NullEngine());
await blend.settled();
blend.playhead.pause();
const skeleton = blend.scene.getSkeletonById('Rig'), skinned = blend.scene.getMeshById(entity.inputs.mesh), skin = skinned.skeleton;
const rigNames = skeleton.bones.map((b) => b.name).filter((n) => !n.includes('#'));
assert.deepEqual(rigNames.sort(), [...rig.data.bones].map((b) => b.name).sort(), 'the rig skeleton holds every bone');
assert.ok(skin !== skeleton && skin.rigId === 'Rig' && skin.bones.length < skeleton.bones.length, `the body skins to a skin skeleton of ${skin.bones.length} of ${skeleton.bones.length} bones`);
assert.ok(!skin.bones.some((b) => b.name === mechanism.name), `${mechanism.name}, weighting nothing, is not in the skin`);
assert.ok(['FK-hand.L', 'MCH-look'].every((name) => rigNames.includes(name)), 'the bones a character writes and reads are in the rig');
assert.deepEqual(findRoles(rigNames), findRoles([...rig.data.bones].map((b) => b.name)), 'every role resolves on the rig');
// The page's modules find the rig: the character's rig, the pose the solve attaches to, the IR's armature entry.
const { skeletonOf } = await import(new URL('bylonder/character/rig.js', written.url).href);
assert.equal(skeletonOf(blend, 'Rig'), skeleton, "the character's skeleton is the rig");
assert.equal(entity.inputs.skeleton, 'Rig', "the pose entity names the rig");
const frame = blend.controls().find((c) => c.path.endsWith('.frame_current')).path;
const absolute = (bone) => (bone.getParent() ? bone._matrix.multiply(absolute(bone.getParent())) : bone._matrix.multiply(skinned.computeWorldMatrix(true)));
const world_ = (m) => babylonMatrix(Array.from(m)).multiply(babylonMatrix(Array.from(rig.matrix_world)));
let worst = 0;
for (const f of FRAMES) {
  blend.set(frame, f);
  for (let i = 0; i < 2; i++) { blend.scene.render(); await blend.settled(); }
  sync.frameChanged(f);
  for (const bone of [...skeleton.bones, ...skin.bones].filter((b) => !b.name.includes('#'))) {
    const ours = absolute(bone).asArray(), theirs = world_(rig.pose.bones.get(bone.name).matrix).asArray();
    const error = Math.max(...theirs.map((v, i) => Math.abs(v - ours[i])));
    assert.ok(error < TOLERANCE, `frame ${f}: ${bone.name} is off by ${error}`);
    worst = Math.max(worst, error);
  }
}
blend.dispose();
written.remove();
console.log(`Export skin skeleton: the rig skeleton keeps all ${skeleton.bones.length} bones, its body skins to ${skin.bones.length}, both posed as Main's within ${worst.toPrecision(2)} at ${FRAMES.length} frames`);
