// Blender's constraint kernels (constraints.wasm) against Main: a rig read from Main (rig-export.js) and evaluated by
// the kernels takes the pose Main evaluates, bone by bone, at frames of its animation: the Rigged Character's IK arms
// and legs, Damped Track and Limit Rotation head and Copy Rotation hands, and, where given, a Rigify rig
// (CONSTRAINTS_BLEND). Each type handed to a unit and back gives the same pose.
// usage: node tests/constraints-module-wasm.test.js [file.blend ...]
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { BlenderMain } from '../src/bmesh/bmesh-wasm.js';
import { setContextPointer, blendData, contextStruct } from '../src/python/bpy_rna.js';
import '../src/python/bpy_interface.js';
import { loadConstraints } from '../src/io_scene_babylon/polyfill/constraints.js';
import { layoutsOf, rigOf, settings } from '../src/io_scene_babylon/rig-export.js';
import { exampleBlend } from './open-example.js';
import dna from '../src/makesrna/dna-constraints.json' with { type: 'json' };

const MODULE = new URL('../src/constraints/constraints.wasm', import.meta.url);
if (!existsSync(MODULE)) {
  console.log('Constraint kernels: skipped, src/constraints/constraints.wasm is not built');
  process.exit(0);
}
const FRAMES = [1, 12, 18, 30, 40, 50, 64];
const TOLERANCE = 1e-4;
const failures = [];
// What an animation sets on a pose bone: its transform and its B-Bone shape.
const OWN = ['location', 'rotation_quaternion', 'rotation_euler', 'rotation_axis_angle', 'scale', 'rotation_mode'];
const own = (name) => OWN.includes(name) || name.startsWith('bbone_');

const kernels = await loadConstraints(MODULE);
const blender = new BlenderMain();
setContextPointer(blender.C);

// A matrix of Main's in memory order (Blender's float[4][4]): the DNA field RNA reads it from.
const PoseBone = layoutsOf('PoseBone');
const poseMatrix = (pb) => settings(pb.as_pointer(), { matrix: dna.PoseBone.properties.matrix }).matrix;
// RNA's matrix_world as Bylonder's RNA gives it: Blender's memory order, column by column.
const worldMatrix = (ob) => Array.from(ob.matrix_world);

function check(path) {
  blender.readBlend(readFileSync(path));
  const armatures = [...blendData().objects].filter((ob) => ob.type === 'ARMATURE' && [...ob.pose.bones].some((pb) => pb.constraints.length));
  assert.ok(armatures.length, `${path}: an armature with bone constraints`);
  for (const ob of armatures) {
    const order = [...ob.data.bones].map((b) => b.name);
    const spec = rigOf(ob, order, (target, bone) => (bone ? undefined : { node: target.name }));
    assert.ok(spec, `${ob.name}: its constraints are the kernels' to run`);
    const rig = kernels.rig(spec), animated = Object.fromEntries(Object.entries(PoseBone).filter(([n]) => own(n)));
    const pose = (frame) => {
      contextStruct().scene.frame_set(frame);
      blender.evaluate();
      order.forEach((name, i) => rig.pose(i, settings(ob.pose.bones.get(name).as_pointer(), animated)));
      const nodes = (node) => worldMatrix(blendData().objects.get(node));
      return rig.evaluate(frame, null, worldMatrix(ob), nodes);
    };
    for (const frame of FRAMES) {
      const ours = pose(frame);
      const off = order.flatMap((name, i) => {
        const theirs = poseMatrix(ob.pose.bones.get(name)), error = Math.max(...theirs.map((v, k) => Math.abs(v - ours[i * 16 + k])));
        return error < TOLERANCE ? [] : [`${name} by ${error.toPrecision(2)}`];
      });
      // B-Bones' segments, posed and at rest, as Main's depsgraph computes them.
      const bbones = order.flatMap((name, i) => {
        const pb = ob.pose.bones.get(name), count = ob.data.bones.get(name).bbone_segments;
        if (count <= 1) return [];
        const { matrices, rest_matrices: rest } = rig.bboneSegments(i);
        const error = Math.max(...matrices.flatMap((m, k) => [[m, false], [rest[k], true]].flatMap(([ours, atRest]) => {
          const theirs = Array.from(pb.bbone_segment_matrix(k, atRest));
          return theirs.map((v, j) => Math.abs(v - ours[j]));
        })));
        return error < TOLERANCE ? [] : [`${name} segments by ${error.toPrecision(2)}`];
      });
      off.push(...bbones);
      if (off.length) failures.push(`${ob.name} frame ${frame}: ${off.join(', ')}`);
    }
    // A type's kernel handed to a unit that runs it as Blender's would (here: hands it back) and returned.
    const types = new Set(spec.bones.flatMap((b) => b.constraints.map((c) => c.type)));
    const before = pose(FRAMES[2]);
    let called = 0;
    for (const type of types) if (type !== 'IK') kernels.use(type, { run: ({ owner }) => (called++, owner) });
    const handed = pose(FRAMES[2]);
    for (const type of types) kernels.use(type, null);
    assert.ok(!types.has('DAMPED_TRACK') || called > 0, 'a unit runs in place of Blender\'s kernel');
    assert.deepEqual(pose(FRAMES[2]), before, 'Blender\'s kernels again once the units are removed');
    assert.notDeepEqual(handed, before, 'units that leave the owner as it is give another pose');
    rig.free();
    console.log(`${ob.name}: ${order.length} bones, ${[...types].join(', ')}, Main's pose at ${FRAMES.length} frames`);
  }
}

const blends = process.argv.slice(2);
for (const path of blends.length ? blends : [exampleBlend('rigged-character')]) check(path);
assert.deepEqual(failures, [], 'bones off the pose Main evaluates');
console.log('Constraint kernels: rigs evaluated by constraints.wasm take Main\'s pose');
