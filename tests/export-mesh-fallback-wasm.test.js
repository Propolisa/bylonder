// Each mesh the native rig runtime deforms beyond its allowance falls back on its own, the rig staying live: the export
// measures the runtime's deform and its Armature alone (Babylon's skinning) against Main's evaluated mesh and keeps the
// closer, Babylon's skinning where it is as close, and names the mesh, both distances and the choice. The allowance
// lowered to nothing (vertexTolerance, as the runtime is exact on every small stack): the Rigged Character's body, whose
// Corrective Smooth only the runtime runs, stays on the runtime; a copy whose Corrective Smooth does nothing (factor 0)
// is skinned in the page.
import assert from 'node:assert/strict';
import { NullEngine, VertexBuffer } from '@babylonjs/core';
import { blendData, contextStruct } from '../src/python/bpy_rna.js';
import { exportModule } from '../src/io_scene_babylon/js-export.js';
import { vertexTolerance } from '../src/io_scene_babylon/pose-export.js';
import { subscribeReports } from '../src/windowmanager/wm-reports.js';
import { openExample } from './open-example.js';
import { writePackage } from './export-package.js';

const { world, sync } = openExample('rigged-character');
const data = blendData(), C = contextStruct(), rig = data.objects.get('Rig'), body = data.objects.get('Body');
Object.assign(rig.pose.bones.get('chest').constraints.new('ACTION'), { use_eval_time: true, eval_time: 0.5, frame_start: 1, frame_end: 21,
  use_bone_object_action: false }).action = rig.animation_data.action;
const copy = (name) => {
  const ob = data.objects.new(name, body.data);
  C.scene.collection.objects.link(ob);
  Object.assign(ob, { parent: body.parent, matrix_parent_inverse: body.matrix_parent_inverse, location: body.location, rotation_euler: body.rotation_euler, scale: body.scale });
  ob.modifiers.new('Armature', 'ARMATURE').object = rig;
  return ob;
};
// A twin the skeleton skins, as the rig's skeleton lives on its skinned meshes.
copy('Twin');
Object.assign(body.modifiers.new('Smooth', 'CORRECTIVE_SMOOTH'), { factor: 0.8, iterations: 4, use_only_smooth: true });
Object.assign(copy('Still').modifiers.new('Smooth', 'CORRECTIVE_SMOOTH'), { factor: 0, iterations: 4, use_only_smooth: true });
sync.view();

const reports = [];
subscribeReports((r) => reports.push(r));
vertexTolerance.distance = 0;
const files = await exportModule(world);
vertexTolerance.distance = 1e-4;
const entity = Object.values(JSON.parse(files['scene.ir.json']).entities).find((e) => e.type === 'constraints:POSE');
assert.equal(entity?.implementation, 'native-rig', 'the rig stays live');
const onRuntime = Object.keys(entity.inputs.native.meshes);
assert.ok(onRuntime.includes('Body') && !onRuntime.includes('Still'), `the body stays on the runtime, its copy does not (${onRuntime})`);
const warning = (name) => reports.find((r) => r.type === 'WARNING' && r.message.startsWith(`${name}: `))?.message ?? '';
assert.match(warning('Body'), /^Body: deformed by the native rig runtime, the closer to Blender's \(the runtime [\d.]+ mm, its Armature alone [\d.]+ mm, 0\.0 mm allowed\)$/);
assert.match(warning('Still'), /^Still: skinned by its Armature alone, the closer to Blender's \(the runtime [\d.]+ mm, its Armature alone [\d.]+ mm, 0\.0 mm allowed\)$/);

const written = writePackage(files);
const blend = await (await import(written.url)).load(new NullEngine());
await blend.settled();
const still = blend.scene.getMeshByName('Still');
assert.ok(still.skeleton && still.getVerticesData(VertexBuffer.MatricesWeightsKind), 'the copy is skinned in the page');
assert.ok(!blend.scene.getMeshByName('Body').skeleton, 'the body is not: the runtime deforms it');
blend.dispose();
written.remove();
console.log('Export mesh fallback: a mesh the runtime deforms beyond its allowance falls back to the closer of the runtime and Babylon skinning, the rig live');
process.exit(0);
