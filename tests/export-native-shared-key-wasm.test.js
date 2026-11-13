// Two meshes holding one Key, as a character's looks on one Mesh do (Snow's head and its tattooed copy): its driven
// corrective, run by the native rig runtime once for the Key, shapes both in the page as Main shapes them.
import assert from 'node:assert/strict';
import { MorphTarget, MorphTargetManager, NullEngine, VertexBuffer } from '@babylonjs/core';
import { blendData, contextStruct } from '../src/python/bpy_rna.js';
import { exportModule } from '../src/io_scene_babylon/js-export.js';
import { subscribeReports } from '../src/windowmanager/wm-reports.js';
import { openExample } from './open-example.js';
import { writePackage } from './export-package.js';

const FRAMES = [1, 11, 21], TOLERANCE = 1e-4;
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
// The elbow corrective's driver given an identity Generator, which the page's driver units do not run: the runtime does.
[...body.data.shape_keys.animation_data.drivers].find((d) => d.data_path === 'key_blocks["Elbow.L"].value').modifiers.new('GENERATOR');
// The body and a copy of it on the same Mesh and Key, each with a Corrective Smooth after its Armature (the runtime's).
const copy = data.objects.new('Copy', body.data);
C.scene.collection.objects.link(copy);
Object.assign(copy, { parent: body.parent, matrix_parent_inverse: body.matrix_parent_inverse, location: body.location, rotation_euler: body.rotation_euler, scale: body.scale });
copy.modifiers.new('Armature', 'ARMATURE').object = rig;
for (const ob of [body, copy]) Object.assign(ob.modifiers.new('Smooth', 'CORRECTIVE_SMOOTH'), { factor: 0.8, iterations: 4, use_only_smooth: true });
sync.blender.tag(sync.objectOf(world.objects.find((n) => n.name === 'Rig')), 2);
sync.view();

const reports = [];
subscribeReports((r) => reports.push(r));
const files = await exportModule(world);
const entity = Object.values(JSON.parse(files['scene.ir.json']).entities).find((e) => e.type === 'constraints:POSE');
for (const name of ['Body', 'Copy']) {
  assert.ok(Object.keys(entity?.inputs.native?.meshes ?? {}).includes(name), `${name} deforms on the runtime`);
  assert.ok(reports.some((r) => r.message.startsWith(`${name}: deformed live by the native rig runtime, within`)), JSON.stringify(reports.map((r) => r.message)));
}

const written = writePackage(files);
const blend = await (await import(written.url)).load(new NullEngine());
// One writer per vertex position: morph targets left on a mesh the runtime deforms (a package's, once it was skinned)
// would pull its deform back toward their rest shapes on the GPU.
const stale = new MorphTargetManager(blend.scene), target = new MorphTarget('stale', 1, blend.scene);
target.setPositions(blend.scene.getMeshByName('Copy').getVerticesData(VertexBuffer.PositionKind));
stale.addTarget(target);
blend.scene.getMeshByName('Copy').morphTargetManager = stale;
await blend.settled();
blend.playhead.pause();
const frame = blend.controls().find((c) => c.path.endsWith('.frame_current')).path;
let worst = 0;
for (const f of FRAMES) {
  blend.set(frame, f);
  for (let i = 0; i < 2; i++) { blend.scene.render(); await blend.settled(); }
  sync.frameChanged(f);
  for (const name of ['Body', 'Copy']) {
    const mesh = sync.blender.evaluatedMesh(sync.objectOf(world.objects.find((n) => n.name === name))), p = mesh.vert_positions;
    const theirs = [...mesh.corner_verts].flatMap((v) => [p[v * 3], p[v * 3 + 2], p[v * 3 + 1]]), ours = blend.scene.getMeshByName(name).getVerticesData(VertexBuffer.PositionKind);
    const error = Math.max(...theirs.map((v, i) => Math.abs(v - ours[i])));
    assert.ok(error < TOLERANCE, `frame ${f}: ${name} is off Main's by ${error}`);
    worst = Math.max(worst, error);
  }
}
for (const name of Object.keys(entity.inputs.native.meshes)) {
  const mesh = blend.scene.getMeshByName(name);
  assert.ok(!mesh.morphTargetManager && !mesh.skeleton, `${name}: deformed by the runtime, and by ${mesh.morphTargetManager ? 'morph targets' : 'a skeleton'} too`);
}
blend.dispose();
written.remove();
console.log(`Export native shared Key: two meshes on one Key take its driven corrective from the runtime, both within ${worst.toPrecision(2)} m of Main`);
process.exit(0);
