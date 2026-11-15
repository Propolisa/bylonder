// tags: behaviors, rigging
// Rock Hard Café's reach is Blender's IK (examples/rock-hard-cafe/cafe.py): the barista's right arm reaches for the
// Hand Target bone (IK on the forearm, two bones, toward the Hand Pole), the hand copies its turn (palm down), and the
// chest leans after it (a Chest Target follows part of its move, IK on the upper spine reaches for that) and turns
// toward it (Locked Track). The exported page solves the same
// constraints live: moving only the Hand Target, the arm and the spine take Main's evaluated pose (Blender's own
// constraint code) for targets near, across, to the side and out of reach.
import assert from 'node:assert/strict';
import { Matrix, NullEngine } from '@babylonjs/core';
import { babylonMatrix } from '../src/blenkernel/main-view.js';
import { blendData } from '../src/python/bpy_rna.js';
import { exportModule } from '../src/io_scene_babylon/js-export.js';
import { openExample } from './open-example.js';
import { writePackage } from './export-package.js';

// The Hand Target's moves from its rest, in its own space (its Y along the barista's front), in metres.
const TARGETS = [[0, 0, 0], [0.25, 0.1, 0.05], [-0.3, 0, -0.1], [0.1, 0.25, 0.1], [0.05, 0.7, 0]];
const BONES = ['DEF-upper_arm.R', 'DEF-forearm.R', 'DEF-hand.R', 'DEF-spine.001', 'DEF-spine.002', 'DEF-spine.003', 'DEF-head'];
// The IK solvers' tolerance, in metres.
const TOLERANCE = 5e-3;

const { world, sync } = openExample('rock-hard-cafe');
const rig = blendData().objects.get('Barista'), target = rig.pose.bones.get('Hand Target');
const ik = (bone) => [...rig.pose.bones.get(bone).constraints].find((c) => c.type === 'IK');
assert.equal(ik('DEF-forearm.R')?.chain_count, 2, 'the arm reaches by an IK of two bones');
assert.ok(ik('DEF-spine.003')?.chain_count === 2 && ik('DEF-spine.003').subtarget === 'Chest Target', 'the chest leans by an IK of two bones toward the Chest Target, the hips left out');
const follow = [...rig.pose.bones.get('Chest Target').constraints].find((c) => c.type === 'COPY_LOCATION');
assert.ok(follow?.subtarget === 'Hand Target' && follow.use_offset && follow.influence < 1, 'the Chest Target follows part of the move of the hand target');
assert.equal([...rig.pose.bones.get('DEF-hand.R').constraints].find((c) => c.type === 'COPY_ROTATION')?.subtarget, 'Hand Target', 'the hand copies the turn of the target: palm down');
sync.view();
const frame = blendData().scenes.get('Rock Hard Café').frame_start;
const files = await exportModule(world, { animations: 'BOTH' });
const entity = Object.values(JSON.parse(files['scene.ir.json']).entities).find((e) => e.type === 'constraints:POSE' && JSON.stringify(e).includes('Hand Target'));
assert.ok(entity, 'the barista\'s IK constraints run in the page');

// Main's pose for each target.
const heads = TARGETS.map((at) => {
  target.location = at;
  sync.frameChanged(frame);
  return new Map(BONES.map((name) => [name, babylonMatrix(Array.from(rig.pose.bones.get(name).matrix)).m.slice(12, 15)]));
});
target.location = [0, 0, 0];

const written = writePackage(files);
const blend = await (await import(written.url)).load(new NullEngine());
await blend.settled();
blend.playhead.pause();
const render = async () => { blend.scene.render(); await blend.settled(); };
await render();
const skeleton = blend.scene.getSkeletonById(entity.inputs.skeleton), unspace = Matrix.Invert(Matrix.FromArray(entity.inputs.space));
const absolute = (bone) => (bone.getParent() ? bone._matrix.multiply(absolute(bone.getParent())) : bone._matrix);
const path = (i) => `objects["Barista"].pose.bones["Hand Target"].location[${i}]`;
let worst = 0;
for (const [n, at] of TARGETS.entries()) {
  at.forEach((v, i) => blend.set(path(i), v));
  await render();
  await render();
  for (const name of BONES) {
    const bone = skeleton.bones.find((b) => b.name === name), theirs = heads[n].get(name);
    const ours = absolute(bone).multiply(unspace).m, error = Math.max(...[0, 1, 2].map((k) => Math.abs(ours[12 + k] - theirs[k])));
    worst = Math.max(worst, error);
    assert.ok(error < TOLERANCE, `target ${at}: ${name} is ${(error * 1000).toFixed(1)} mm from Main`);
  }
}
blend.dispose();
written.remove();
console.log(`Café reach IK: the page's ${entity.implementation} solve of the barista's arm and spine IK is within ${(worst * 1000).toFixed(1)} mm of Main for ${TARGETS.length} targets`);
process.exit(0);
