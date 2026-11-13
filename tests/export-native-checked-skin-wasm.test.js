// Exports keep a mesh's cheaper skinning only when it matches Blender within 0.1 mm: on a rig the native rig runtime
// poses, a mesh Babylon would skin with an approximation (a Subdivision Surface after its Armature, applied to the rest it
// skins) is checked like the others, and the runtime, exact, deforms it; one plain skinning matches stays skinned. On a
// rig the constraint kernels pose, a mesh whose skinning approximates is named as not vertex-checked.
import assert from 'node:assert/strict';
import { blendData, contextStruct } from '../src/python/bpy_rna.js';
import { exportModule } from '../src/io_scene_babylon/js-export.js';
import { subscribeReports } from '../src/windowmanager/wm-reports.js';
import { openExample } from './open-example.js';
import { writePackage } from './export-package.js';
import { NullEngine } from '@babylonjs/core';

const { world, sync } = openExample('rigged-character');
const data = blendData(), C = contextStruct(), rig = data.objects.get('Rig'), body = data.objects.get('Body');
const reports = [];
subscribeReports((r) => reports.push(r));
// A copy of the body skinned by the rig, its Subdivision Surface after its Armature.
const smooth = data.objects.new('Smooth', body.data.copy());
C.scene.collection.objects.link(smooth);
Object.assign(smooth, { parent: body.parent, matrix_parent_inverse: body.matrix_parent_inverse, location: body.location, rotation_euler: body.rotation_euler, scale: body.scale });
smooth.modifiers.new('Armature', 'ARMATURE').object = rig;
smooth.modifiers.new('Subdivision', 'SUBSURF').levels = 1;
sync.view();

await exportModule(world);
assert.ok(reports.some((r) => r.type === 'WARNING' && /^Rig: not vertex-checked against Blender, skinned by Babylon with .*Smooth \([^)]*Subdivision\)/.test(r.message)), JSON.stringify(reports.map((r) => r.message)));

// An Action constraint, which Blender's constraint kernels do not run, puts the rig on the native runtime.
Object.assign(rig.pose.bones.get('chest').constraints.new('ACTION'), { use_eval_time: true, eval_time: 0.5, frame_start: 1, frame_end: 21,
  use_bone_object_action: false }).action = rig.animation_data.action;
sync.blender.tag(sync.objectOf(world.objects.find((n) => n.name === 'Rig')), 2);
sync.view();
reports.length = 0;
const files = await exportModule(world);
const meshes = Object.keys(Object.values(JSON.parse(files['scene.ir.json']).entities).find((e) => e.type === 'constraints:POSE')?.inputs.native?.meshes ?? {});
assert.ok(meshes.includes('Smooth'), `the approximated mesh deforms on the runtime (${meshes})`);
assert.ok(reports.some((r) => /^Smooth: deformed live by the native rig runtime, within/.test(r.message)), JSON.stringify(reports.map((r) => r.message)));
assert.ok(!meshes.includes('Body'), 'the body, which plain skinning matches, stays skinned');
// Every mesh the rig deforms on the runtime (the body too, given its own Subdivision after its Armature): the rig's
// skeleton is exported all the same, and the page poses it.
body.modifiers.new('Subdivision', 'SUBSURF').levels = 1;
sync.view();
reports.length = 0;
const all = await exportModule(world);
const ir = JSON.parse(all['scene.ir.json']), pose = Object.values(ir.entities).find((e) => e.type === 'constraints:POSE');
assert.ok(['Body', 'Smooth'].every((name) => Object.keys(pose?.inputs.native?.meshes ?? {}).includes(name)), 'every mesh deforms on the runtime');
const written = writePackage(all);
const blend = await (await import(written.url)).load(new NullEngine());
await blend.settled();
blend.playhead.pause();
const skeleton = blend.scene.getSkeletonById(pose.inputs.skeleton);
assert.ok(skeleton, 'the skeleton is exported');
const frame = blend.controls().find((c) => c.path.endsWith('.frame_current')).path, hand = skeleton.bones.find((b) => b.name.startsWith('hand'));
const handAt = async (f) => { blend.set(frame, f); for (let i = 0; i < 2; i++) { blend.scene.render(); await blend.settled(); } return hand.getLocalMatrix().clone(); };
assert.ok(!(await handAt(1)).equalsWithEpsilon(await handAt(11), 1e-4), 'and posed');
blend.dispose();
written.remove();
console.log('Export native checked skin: a mesh whose skinning approximates goes to the runtime, one plain skinning matches stays skinned, and a kernel rig names what it leaves unchecked');
process.exit(0);
