// The JavaScript export's bone constraints against Blender's: the Rigged Character's rig (IK arms and legs with pole
// targets, a head that Damped Track and Limit Rotation turn toward an empty, hands that copy their IK targets'
// rotation), exported and loaded, takes the pose Main evaluates at frames of its animation with the constraints run in
// the page on Blender's kernels (bylonder-constraints/), not sampled; moving an IK target or its pole through the page's controls moves the rig. Its controls (an
// IK/FK switch and a Breathe slider, custom properties that drivers read) and its elbow's corrective shape key, driven by
// the posed arm's angle, morph and pose the skinned body as Main does. Its tail, a B-Bone, bends by the joints of its
// segments, which the kernels shape, as does an arm the IK solver moves. A pose set as the page loads, before the
// constraints attach, holds.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
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
assert.equal(entity?.implementation, 'pose-kernels', 'the page runs the rig constraints on Blender kernels');
assert.deepEqual(entity.inputs.kernels.bones.filter((b) => b.constraints.length).map((b) => b.name).sort(), ['forearm.L', 'forearm.R', 'hand.L', 'hand.R', 'head', 'shin.L', 'shin.R']);
assert.deepEqual(entity.inputs.segments, ['tail'], 'the kernels bend the tail, its animated B-Bone shape fed from its controls');
const groups = JSON.parse(/const ANIMATION_GROUPS = (.*);\n/.exec(files['scene.js'])[1]);
const sampled = groups.flatMap((g) => g.targetedAnimations).filter((t) => /^Rig /.test(t.targetId) && t.animation.keys.length > 1).map((t) => t.targetId);
const joints = Array.from({ length: 9 }, (_, k) => `Rig tail#${k}`);
assert.deepEqual(sampled, joints, "no bone is sampled, only the tail's segment joints");

const written = writePackage(files);
assert.ok(existsSync(join(written.dir, 'bylonder-constraints/constraints.wasm')), 'the package ships the kernels');
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

// A pose set as soon as the page loads, before its constraints attach, holds: the left forearm bent in FK, alike in a
// page posed after it settled.
const BENT = [['objects["Rig"]["ik_fk.L"]', 0], ...[0.6, 0.8, 0, 0].map((v, i) => [`objects["Rig"].pose.bones["forearm.L"].rotation_quaternion[${i}]`, v])];
const leftArm = (b) => ['forearm.L', 'hand.L'].map((name) => Array.from(b.scene.getSkeletonById('Rig').bones.find((bone) => bone.name === name).getAbsoluteMatrix().asArray()));
const unbent = leftArm(blend)[0];
const early = await (await import(written.url)).load(new NullEngine());
early.playhead.pause();
for (const [path, value] of [[frameControl.path, frame], ...BENT]) early.set(path, value);
for (const [path, value] of BENT) blend.set(path, value);
for (const b of [early, blend]) for (let i = 0; i < 2; i++) { b.scene.render(); await b.settled(); }
const offBy = Math.max(...leftArm(early).flatMap((m, k) => m.map((v, i) => Math.abs(v - leftArm(blend)[k][i]))));
assert.ok(offBy < 1e-6, `a pose set before the constraints attach holds (off by ${offBy})`);
assert.ok(!Matrix.FromArray(leftArm(blend)[0]).equalsWithEpsilon(Matrix.FromArray(unbent), 1e-3), 'the forearm bent');
console.log('Export pose constraints: a pose set as the page loads holds once its constraints attach');

early.dispose();
blend.dispose();
written.remove();

// A B-Bone the IK solver moves (the right arm given 4 segments): its segment joints bend with its handles as Main bends
// them when the page moves the IK target, not as the samples had them.
for (const name of ['upper_arm.R', 'forearm.R']) rig.data.bones.get(name).bbone_segments = 4;
handTarget.location[0] = handTarget.location[2] = pole.location[0] = 0;
sync.frameChanged(frame);
sync.view();
const bent = writePackage(await exportModule(world)), arms = await (await import(bent.url)).load(new NullEngine());
await arms.settled();
arms.playhead.pause();
const armsSkeleton = arms.scene.getSkeletonById('Rig'), armsBody = arms.scene.getMeshById(entity.inputs.mesh);
const armsAbsolute = (bone) => (bone.getParent() ? bone._matrix.multiply(armsAbsolute(bone.getParent())) : bone._matrix.multiply(armsBody.computeWorldMatrix(true)));
for (const [path, value] of [[frameControl.path, frame], ...moves.slice(0, 2).map(([p, v]) => [p, v])]) arms.set(path, value);
for (let i = 0; i < 2; i++) { arms.scene.render(); await arms.settled(); }
moves.slice(0, 2).forEach(([, value, setMain]) => setMain(value));
sync.frameChanged(frame);
const segmentError = Math.max(...['upper_arm.R', 'forearm.R'].flatMap((name) => Array.from({ length: 5 }, (_, k) => {
  const theirs = main().get(`${name}#${k}`), ours = armsAbsolute(armsSkeleton.bones.find((b) => b.name === `${name}#${k}`));
  return Math.max(...theirs.asArray().map((v, i) => Math.abs(v - ours.asArray()[i])));
})));
assert.ok(segmentError < TOLERANCE, `a constraint-driven B-Bone's segments follow the IK target (off by ${segmentError})`);
console.log('Export pose constraints: a B-Bone the IK solver moves bends its segments as Main does');

// A unit registered for bbone:SEGMENTS shapes the segments in the kernels' place, given the bone and its handles.
const { register, unregister } = await import(new URL('bylonder/units.js', bent.url).href);
const given = [];
register('bbone:SEGMENTS', { run: (inputs) => { given.push(inputs); return { matrices: Array.from({ length: 5 }, () => Matrix.Identity().asArray()) }; } });
for (let i = 0; i < 2; i++) { arms.scene.render(); await arms.settled(); }
const joint = armsSkeleton.bones.find((b) => b.name === 'forearm.R#2');
assert.ok(joint._matrix.equalsWithEpsilon(Matrix.Identity(), 1e-6), 'the segments of the unit pose the joints');
const arm = given.find((inputs) => inputs.bone.bbone_segments === 4 && inputs.prev);
assert.ok(arm?.pose.length === 16 && arm.prev.pose.length === 16 && arm.prev.rest.length === 16, 'the unit is given the bone, its handles and its settings');
unregister('bbone:SEGMENTS');
for (let i = 0; i < 2; i++) { arms.scene.render(); await arms.settled(); }
assert.ok(!joint._matrix.equalsWithEpsilon(Matrix.Identity(), 1e-6), 'the kernels shape them again once it is removed');
console.log('Export pose constraints: a bbone:SEGMENTS unit takes the place of the kernels');
arms.dispose();
bent.remove();
