// What the native rig runtime takes from Main besides the bones' own poses: the Rigged Character's rig, on the runtime
// for an Action constraint, is accepted by the export and posed in the page as Main poses it at frames of its animation,
// with its head's Damped Track weighed by a driver reading the Z rotation of a bone in YXZ order (the runtime takes that
// bone in its own rotation mode, so the driver reads the same angle) and its right hand's last Copy Rotation keyed from 0
// to 1 (the runtime takes the keyed influence at each frame); and its spine, whose location its animation keys, turned
// halfway by a Copy Rotation (the page writes the constrained pose over the keyed one each frame, and the export's check
// judges the pose as the page writes it).
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
const rig = blendData().objects.get('Rig'), ad = rig.animation_data, bones = rig.pose.bones;
const driver = (path, expression) => Object.assign(ad.drivers.new(path, 0).driver, { type: 'SCRIPTED', expression });

// An Action constraint, which Blender's constraint kernels do not run: the rig goes to the native runtime.
Object.assign(bones.get('chest').constraints.new('ACTION'), { use_eval_time: true, eval_time: 0.5, frame_start: 1, frame_end: 21, use_bone_object_action: false }).action = ad.action;

// Copy Rotations of a turned target, to weigh.
bones.get('knee_pole.L').rotation_quaternion = [0.8, 0.36, 0.36, 0.32];
const copyOf = (bone) => Object.assign(bones.get(bone).constraints.new('COPY_ROTATION'), { target: rig, subtarget: 'knee_pole.L' });

Object.assign(bones.get('hand_ik.R'), { rotation_mode: 'YXZ', rotation_euler: [0.6, 0.5, 0.7] });
const track = [...bones.get('head').constraints].find((c) => c.type === 'DAMPED_TRACK');
const angle = driver(`pose.bones["head"].constraints["${track.name}"].influence`, 'var');
Object.assign(angle.variables.new(), { name: 'var', type: 'TRANSFORMS' });
Object.assign(angle.variables[0].targets[0], { id: rig, bone_target: 'hand_ik.R', transform_type: 'ROT_Z', transform_space: 'LOCAL_SPACE' });

const hand = copyOf('hand.R');
const keyed = ad.action.layers[0].strips[0].channelbag(ad.action_slot).fcurves.new(`pose.bones["hand.R"].constraints["${hand.name}"].influence`, 0);
keyed.keyframe_points.insert(1, 0);
keyed.keyframe_points.insert(21, 1);
// A Copy Rotation on a bone its animation keys (the spine's location): the page keeps the constrained pose over the keyed one.
copyOf('spine').influence = 0.5;
sync.blender.tag(sync.objectOf(world.objects.find((n) => n.name === 'Rig')), 2);
sync.view();

const files = await exportModule(world);
const entity = Object.values(JSON.parse(files['scene.ir.json']).entities).find((e) => e.type === 'constraints:POSE');
assert.equal(entity?.implementation, 'native-rig', 'the export accepts the native runtime');

const written = writePackage(files);
const blend = await (await import(written.url)).load(new NullEngine());
await blend.settled();
blend.playhead.pause();
const skeleton = blend.scene.getSkeletonById('Rig'), skinned = blend.scene.getMeshById(entity.inputs.mesh);
const frame = blend.controls().find((c) => c.path.endsWith('.frame_current')).path;
const absolute = (bone) => (bone.getParent() ? bone._matrix.multiply(absolute(bone.getParent())) : bone._matrix.multiply(skinned.computeWorldMatrix(true)));
const world_ = (m) => babylonMatrix(Array.from(m)).multiply(babylonMatrix(Array.from(rig.matrix_world)));
for (const f of FRAMES) {
  blend.set(frame, f);
  for (let i = 0; i < 2; i++) { blend.scene.render(); await blend.settled(); }
  sync.frameChanged(f);
  for (const pb of bones) {
    const ours = absolute(skeleton.bones.find((b) => b.name === pb.name)), theirs = world_(pb.matrix);
    const error = Math.max(...theirs.asArray().map((v, i) => Math.abs(v - ours.asArray()[i])));
    assert.ok(error < TOLERANCE, `frame ${f}: ${pb.name} is off by ${error}`);
  }
}
blend.dispose();
written.remove();
console.log(`Export native rig inputs: a driver reading a YXZ bone's angle, a keyed influence and a keyed bone's constraint pose the rig on the native runtime as Main at ${FRAMES.length} frames`);
process.exit(0);
