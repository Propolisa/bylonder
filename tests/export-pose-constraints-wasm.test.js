// The JavaScript export's bone constraints against Blender's: the Rigged Character's rig (IK arms and legs with pole
// targets, a head that Damped Track and Limit Rotation turn toward an empty, hands that copy their IK targets'
// rotation), exported and loaded, takes the pose Main evaluates at frames of its animation with the constraints run in
// the page, not sampled; moving an IK target or its pole through the page's controls moves the rig.
import assert from 'node:assert/strict';
import { Matrix, NullEngine } from '@babylonjs/core';
import { babylonMatrix } from '../src/blenkernel/main-view.js';
import { blendData } from '../src/python/bpy_rna.js';
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
assert.deepEqual(sampled, [], 'no bone is sampled');

const written = writePackage(files);
const blend = await (await import(written.url)).load(new NullEngine());
await blend.settled();
const page = blend.scene, frameControl = blend.controls().find((c) => c.path.endsWith('.frame_current'));
const skeleton = page.getSkeletonById('Rig'), body = page.getMeshById(entity.inputs.mesh);
blend.playhead.pause();

// Each bone's matrix in the world, in the page and in Main.
const absolute = (bone) => (bone.getParent() ? bone._matrix.multiply(absolute(bone.getParent())) : bone._matrix.multiply(body.computeWorldMatrix(true)));
const drawn = () => new Map(skeleton.bones.map((b) => [b.name, absolute(b)]));
const main = () => new Map([...rig.pose.bones].map((pb) => [pb.name, babylonMatrix(Array.from(pb.matrix)).multiply(babylonMatrix(Array.from(rig.matrix_world)))]));
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
