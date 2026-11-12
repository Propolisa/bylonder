// A mesh on an armature the native rig runtime poses, whose stack the runtime cannot run (a Solidify after its Armature),
// moves in the page: Babylon skins it by its Armature with its other modifiers applied to the rest it skins, reported,
// instead of standing as Main evaluated it at the frame exported (the Bar Scene's eyes, corneas and eyebrows).
import assert from 'node:assert/strict';
import { NullEngine, VertexBuffer } from '@babylonjs/core';
import { blendData, contextStruct } from '../src/python/bpy_rna.js';
import { exportModule } from '../src/io_scene_babylon/js-export.js';
import { subscribeReports } from '../src/windowmanager/wm-reports.js';
import { writePackage } from './export-package.js';
import { openExample } from './open-example.js';

const { world, sync } = openExample('rigged-character');
const data = blendData(), C = contextStruct(), rig = data.objects.get('Rig'), body = data.objects.get('Body');
// An Action constraint, which Blender's constraint kernels do not run, puts the rig on the native runtime.
Object.assign(rig.pose.bones.get('chest').constraints.new('ACTION'), { use_eval_time: true, eval_time: 0.5, frame_start: 1, frame_end: 21,
  use_bone_object_action: false }).action = rig.animation_data.action;
// A twin the skeleton skins, as the rig's skeleton lives on its skinned meshes.
const twin = data.objects.new('Twin', body.data);
C.scene.collection.objects.link(twin);
Object.assign(twin, { parent: body.parent, matrix_parent_inverse: body.matrix_parent_inverse, location: body.location, rotation_euler: body.rotation_euler, scale: body.scale });
twin.modifiers.new('Armature', 'ARMATURE').object = rig;
body.modifiers.new('Shell', 'SOLIDIFY').thickness = 0.01;
sync.blender.tag(sync.objectOf(world.objects.find((n) => n.name === 'Rig')), 2);
sync.view();

const reports = [];
subscribeReports((r) => reports.push(r));
const files = await exportModule(world);
const entity = Object.values(JSON.parse(files['scene.ir.json']).entities).find((e) => e.type === 'constraints:POSE');
assert.equal(entity?.implementation, 'native-rig', 'the rig runs on the native runtime');
assert.ok(!Object.keys(entity.inputs.native.meshes ?? {}).includes('Body'), 'the runtime does not deform the body');
assert.ok(reports.some((r) => /^Rig: exported: approximated, Body: skinned by its Armature, its other modifiers applied to its rest/.test(r.message)), JSON.stringify(reports.map((r) => r.message)));
assert.ok(!reports.some((r) => /evaluated as Blender, Body/.test(r.message)), 'not left as Blender evaluated it');

const written = writePackage(files);
const blend = await (await import(written.url)).load(new NullEngine());
await blend.settled();
blend.playhead.pause();
const frame = blend.controls().find((c) => c.path.endsWith('.frame_current')).path, drawn = blend.scene.getMeshByName('Body');
assert.ok(drawn.skeleton, 'the body is skinned');
const center = (f) => {
  blend.set(frame, f);
  blend.scene.render();
  drawn.refreshBoundingInfo({ applySkeleton: true });
  return drawn.getBoundingInfo().boundingBox.centerWorld.clone();
};
const moved = center(1).subtract(center(11)).length();
assert.ok(moved > 1e-3, `the body moves between frames 1 and 11 (${moved})`);
assert.equal(drawn.getTotalVertices(), drawn.getVerticesData(VertexBuffer.MatricesWeightsKind).length / 4, 'every vertex is weighted');
blend.dispose();
written.remove();
console.log('Export native unmoved: a mesh the native runtime cannot deform is skinned with its other modifiers applied to its rest, and moves');
process.exit(0);
