// The JavaScript export's bone constraints against Blender's: the Rigged Character's rig (IK arms and legs with pole
// targets, a head that Damped Track and Limit Rotation turn toward an empty, hands that copy their IK targets'
// rotation), exported and loaded, takes the pose Main evaluates at frames of its animation with the constraints run in
// the page, not sampled; moving an IK target or its pole through the page's controls moves the rig. Its controls (an
// IK/FK switch and a Breathe slider, custom properties that drivers read) and its elbow's corrective shape key, driven by
// the posed arm's angle, morph and pose the skinned body as Main does. Its tail, a B-Bone, bends by the joints of its
// segments, sampled from Main.
import assert from 'node:assert/strict';
import { Matrix, NullEngine } from '@babylonjs/core';
import { babylonMatrix } from '../src/blenkernel/main-view.js';
import { blendData } from '../src/python/bpy_rna.js';
import { setCustomProperty } from '../src/blenkernel/animation/anim-blender.js';
import { exportModule } from '../src/io_scene_babylon/js-export.js';
import { openExample } from './open-example.js';
import { writePackage } from './export-package.js';

const FRAMES = [1, 12, 18, 30, 40, 50, 64];
// The IK solver's tolerance, as a matrix's entries.
const TOLERANCE = 1e-3;

const { world, sync } = openExample('rigged-character');
const rig = blendData().objects.get('Rig');
sync.view();
const files = await exportModule(world);
const ir = JSON.parse(files['scene.ir.json']);
const entity = Object.values(ir.entities).find((e) => e.type === 'constraints:POSE');
assert.equal(entity?.implementation, 'pose', 'the page runs the rig\'s constraints');
assert.deepEqual(Object.keys(entity.inputs.constraints).sort(), ['forearm.L', 'forearm.R', 'hand.L', 'hand.R', 'head', 'shin.L', 'shin.R']);
const groups = JSON.parse(/const ANIMATION_GROUPS = (.*);\n/.exec(files['scene.js'])[1]);
const sampled = groups.flatMap((g) => g.targetedAnimations).filter((t) => /^Rig /.test(t.targetId) && t.animation.keys.length > 1).map((t) => t.targetId);
const joints = Array.from({ length: 9 }, (_, k) => `Rig tail#${k}`);
assert.deepEqual(sampled, joints, "no bone is sampled, only the tail's segment joints");

const written = writePackage(files);
const blend = await (await import(written.url)).load(new NullEngine());
await blend.settled();
const page = blend.scene, frameControl = blend.controls().find((c) => c.path.endsWith('.frame_current'));
const skeleton = page.getSkeletonById('Rig'), body = page.getMeshById(entity.inputs.mesh);
blend.playhead.pause();

// Each bone's matrix in the world, in the page and in Main.
const absolute = (bone) => (bone.getParent() ? bone._matrix.multiply(absolute(bone.getParent())) : bone._matrix.multiply(body.computeWorldMatrix(true)));
const drawn = () => new Map(skeleton.bones.map((b) => [b.name, absolute(b)]));
const world_ = (m) => babylonMatrix(Array.from(m)).multiply(babylonMatrix(Array.from(rig.matrix_world)));
const main = () => new Map([...rig.pose.bones].flatMap((pb) => [[pb.name, world_(pb.matrix)],
  ...Array.from({ length: pb.bone.bbone_segments > 1 ? pb.bone.bbone_segments + 1 : 0 }, (_, k) => [`${pb.name}#${k}`, babylonMatrix(Array.from(pb.bbone_segment_matrix(k, false))).multiply(world_(pb.matrix))])]));
function compare(label) {
  const ours = drawn(), theirs = main();
  for (const [name, m] of theirs) {
    const error = Math.max(...m.asArray().map((v, i) => Math.abs(v - ours.get(name).asArray()[i])));
    assert.ok(error < TOLERANCE, `${label}: ${name} is off by ${error}: ${ours.get(name).asArray().map((v) => v.toFixed(2))} Main ${m.asArray().map((v) => v.toFixed(2))}`);
  }
}
async function show(frame) {
  blend.set(frameControl.path, frame);
  page.render();
  await blend.settled();
  page.render();
}
for (const frame of FRAMES) {
  await show(frame);
  sync.frameChanged(frame);
  compare(`frame ${frame}`);
}
console.log(`The rig takes Main's pose at ${FRAMES.length} frames, its IK, Damped Track, Limit Rotation and Copy Rotation run in the page`);

// The rig's controls: the Breathe slider and the Elbow.L corrective, driven by a custom property and by the angle of
// the posed arm, morph the skinned body as Main's drivers set its keys; the IK/FK switch blends the left arm.
const keys = blendData().shape_keys.get(body.morphTargetManager ? 'Key' : '');
const influences = () => Object.fromEntries(['Breathe', 'Elbow.L'].map((name) => [name, body.morphTargetManager.getTargetByName(name).influence]));
for (const path of ['objects["Rig"]["ik_fk.L"]', 'objects["Rig"]["breathe"]', 'shape_keys["Key"].key_blocks["Elbow.L"].value']) assert.ok(blend.controls().some((c) => c.path === path), `${path} is a control`);
// Each key's normals whole: Blender's, read past the RNA buffer's first 256 floats.
for (const name of ['Breathe', 'Elbow.L']) assert.ok(body.morphTargetManager.getTargetByName(name).getNormals().every(Number.isFinite), `${name}'s normals`);
for (const frame of [1, 18, 36, 50]) {
  await show(frame);
  sync.frameChanged(frame);
  for (const [name, value] of Object.entries(influences())) assert.ok(Math.abs(value - keys.key_blocks.get(name).value) < 2e-3, `frame ${frame}: ${name} ${value}, Main ${keys.key_blocks.get(name).value}`);
}
for (const [path, value] of [['objects["Rig"]["ik_fk.L"]', 0.4], ['objects["Rig"]["breathe"]', 0.7]]) blend.set(path, value);
await show(30);
const rigPointer = sync.objectOf(world.objects.find((n) => n.name === 'Rig'));
setCustomProperty(rigPointer, 'ik_fk.L', 0.4);
setCustomProperty(rigPointer, 'breathe', 0.7);
// A property set from code is an edit: Main evaluates its drivers again once the object is tagged.
sync.blender.tag(rigPointer, 2);
sync.frameChanged(30);
compare('left arm at 0.4 IK');
assert.ok(Math.abs(influences().Breathe - keys.key_blocks.get('Breathe').value) < 1e-6 && influences().Breathe > 0.69, 'the Breathe slider sets its key');
assert.ok(Math.abs(influences()['Elbow.L'] - keys.key_blocks.get('Elbow.L').value) < 2e-3, 'the corrective follows the blended arm');
console.log('Export rig controls: the IK/FK switch, the Breathe slider and the elbow corrective run in the page as Main evaluates them');
// The right hand's IK target and its pole moved through the page's controls, and in Main.
const handTarget = rig.pose.bones.get('hand_ik.R'), pole = rig.pose.bones.get('elbow_pole.R');
const moves = [['objects["Rig"].pose.bones["hand_ik.R"].location[0]', 0.3, (v) => { handTarget.location[0] = v; }],
  ['objects["Rig"].pose.bones["hand_ik.R"].location[2]', 0.35, (v) => { handTarget.location[2] = v; }],
  ['objects["Rig"].pose.bones["elbow_pole.R"].location[0]', -0.4, (v) => { pole.location[0] = v; }]];
const frame = 24;
await show(frame);
const before = drawn().get('forearm.R').asArray();
for (const [path, value] of moves) blend.set(path, value);
await show(frame);
moves.forEach(([, value, setMain]) => setMain(value));
sync.frameChanged(frame);
compare('moved targets');
assert.ok(!Matrix.FromArray(before).equalsWithEpsilon(drawn().get('forearm.R'), 1e-3), 'the arm moved');
console.log('Export pose constraints: moving an IK target and its pole in the page moves the rig as Main poses it');

blend.dispose();
written.remove();
