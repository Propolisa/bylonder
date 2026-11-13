// A character's other look, switched on by a driver (Snow's Skin, between his plain and tattooed meshes): a mesh of
// the rig that Blender's render leaves out at the export's setting, and the viewport hides by its own driver, is read
// all the same, so the native rig runtime deforms it, checked against Main; switched on in the page, it deforms as Main's.
import assert from 'node:assert/strict';
import { NullEngine, VertexBuffer } from '@babylonjs/core';
import { blendData, contextStruct } from '../src/python/bpy_rna.js';
import { setCustomProperty } from '../src/blenkernel/animation/anim-blender.js';
import { exportModule } from '../src/io_scene_babylon/js-export.js';
import { subscribeReports } from '../src/windowmanager/wm-reports.js';
import { openExample } from './open-example.js';
import { writePackage } from './export-package.js';

const FRAME = 11, TOLERANCE = 1e-4;
const { world, sync } = openExample('rigged-character');
const data = blendData(), C = contextStruct(), rig = data.objects.get('Rig'), body = data.objects.get('Body');
const rigPointer = sync.objectOf(world.objects.find((n) => n.name === 'Rig'));
// An Action constraint, which Blender's constraint kernels do not run, puts the rig on the native runtime.
Object.assign(rig.pose.bones.get('chest').constraints.new('ACTION'), { use_eval_time: true, eval_time: 0.5, frame_start: 1, frame_end: 21,
  use_bone_object_action: false }).action = rig.animation_data.action;
setCustomProperty(rigPointer, 'skin', 0);
// Its expression of the rig's `skin` on an object's flag.
const drive = (ob, path, expression) => {
  const driver = (ob.animation_data ?? ob.animation_data_create()).drivers.new(path, 0).driver;
  Object.assign(driver, { type: 'SCRIPTED', expression });
  Object.assign(Object.assign(driver.variables.new(), { name: 'skin', type: 'SINGLE_PROP' }).targets[0], { id: rig, data_path: '["skin"]' });
};
// A twin the skeleton skins, as the rig's skeleton lives on its skinned meshes.
const twin = data.objects.new('Twin', body.data);
C.scene.collection.objects.link(twin);
Object.assign(twin, { parent: body.parent, matrix_parent_inverse: body.matrix_parent_inverse, location: body.location, rotation_euler: body.rotation_euler, scale: body.scale });
twin.modifiers.new('Armature', 'ARMATURE').object = rig;
// The other look: the body's shape with a Corrective Smooth after its Armature, which Babylon cannot skin.
const tattooed = data.objects.new('Tattooed', body.data.copy());
C.scene.collection.objects.link(tattooed);
Object.assign(tattooed, { parent: body.parent, matrix_parent_inverse: body.matrix_parent_inverse, location: body.location, rotation_euler: body.rotation_euler, scale: body.scale });
tattooed.modifiers.new('Armature', 'ARMATURE').object = rig;
Object.assign(tattooed.modifiers.new('Smooth', 'CORRECTIVE_SMOOTH'), { factor: 0.8, iterations: 4, use_only_smooth: true });
drive(tattooed, 'hide_render', 'skin != 1');
drive(tattooed, 'hide_viewport', 'not skin == 1');
sync.blender.tag(rigPointer, 2);
sync.view();
assert.equal(tattooed.hide_render, true, 'the other look is left out of renders at the export');

const reports = [];
subscribeReports((r) => reports.push(r));
const files = await exportModule(world);
const entity = Object.values(JSON.parse(files['scene.ir.json']).entities).find((e) => e.type === 'constraints:POSE');
assert.ok(Object.keys(entity?.inputs.native?.meshes ?? {}).includes('Tattooed'), 'the other look deforms on the runtime');
assert.ok(reports.some((r) => /^Tattooed: deformed live by the native rig runtime, within/.test(r.message)), JSON.stringify(reports.map((r) => r.message)));

const written = writePackage(files);
const blend = await (await import(written.url)).load(new NullEngine());
await blend.settled();
blend.playhead.pause();
const drawn = blend.scene.getMeshByName('Tattooed');
assert.ok(!drawn.isEnabled() || !drawn.isVisible, 'hidden at the export\'s setting');
blend.set('objects["Rig"]["skin"]', 1);
blend.set(blend.controls().find((c) => c.path.endsWith('.frame_current')).path, FRAME);
for (let i = 0; i < 2; i++) { blend.scene.render(); await blend.settled(); }
assert.ok(drawn.isEnabled() && drawn.isVisible, 'shown once switched on');
// Main at the same setting and frame, the other look's evaluated mesh as the page draws it.
setCustomProperty(rigPointer, 'skin', 1);
sync.blender.tag(rigPointer, 2);
sync.view();
sync.frameChanged(FRAME);
const mesh = sync.blender.evaluatedMesh(sync.objectOf(world.objects.find((n) => n.name === 'Tattooed'))), p = mesh.vert_positions;
const theirs = [...mesh.corner_verts].flatMap((v) => [p[v * 3], p[v * 3 + 2], p[v * 3 + 1]]), ours = drawn.getVerticesData(VertexBuffer.PositionKind);
const error = Math.max(...theirs.map((v, i) => Math.abs(v - ours[i])));
assert.ok(error < TOLERANCE, `frame ${FRAME}: the other look is off Main's by ${error}`);
blend.dispose();
written.remove();
console.log(`Export native looks: a look a driver leaves out of renders deforms on the runtime, and switched on matches Main's within ${error.toPrecision(2)} m`);
process.exit(0);
