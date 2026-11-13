// Every edit of a mesh's vertices changes its geometry entry in the next export (scene-tables.js), whatever draws it in
// the app: a plain mesh, a mesh Babylon skins by its Armature, and a copy whose Corrective Smooth the native rig runtime
// runs. An unchanged geometry entry would make a patch that leaves the open page showing the old shape. The edit is the
// editors' (Edit Mode, its vertices moved, back to Object Mode), which tags the mesh as Blender's tools do.
import assert from 'node:assert/strict';
import { blendData, contextStruct } from '../src/python/bpy_rna.js';
import { exportPackage } from '../src/io_scene_babylon/js-export.js';
import { openExample } from './open-example.js';

const { world, sync } = openExample('rigged-character');
const data = blendData(), C = contextStruct(), rig = data.objects.get('Rig'), body = data.objects.get('Body');
Object.assign(rig.pose.bones.get('chest').constraints.new('ACTION'), { use_eval_time: true, eval_time: 0.5, frame_start: 1, frame_end: 21, use_bone_object_action: false })
  .action = rig.animation_data.action;
const copy = (name, modifiers) => {
  const ob = data.objects.new(name, body.data.copy());
  C.scene.collection.objects.link(ob);
  Object.assign(ob, { parent: body.parent, matrix_parent_inverse: body.matrix_parent_inverse, location: body.location, rotation_euler: body.rotation_euler, scale: body.scale });
  modifiers(ob);
  return ob;
};
copy('Plain', () => {});
copy('Smooth', (ob) => {
  ob.modifiers.new('Armature', 'ARMATURE').object = rig;
  Object.assign(ob.modifiers.new('Smooth', 'CORRECTIVE_SMOOTH'), { factor: 0.8, iterations: 4, use_only_smooth: true });
});
const node = (name) => world.objects.find((n) => n.name === name);
sync.blender.tag(sync.objectOf(node('Rig')), 2);
sync.view();
const geometryOf = async () => {
  const { tables } = await exportPackage(world);
  return (name) => JSON.stringify(tables.geometries[tables.nodes[`OB:${name}`]?.geometry]);
};

const before = await geometryOf();
for (const name of ['Plain', 'Body', 'Smooth']) sync.run(() => {
  for (const ob of data.objects) ob.select_set(false);
  const ob = data.objects.get(name);
  ob.select_set(true);
  C.view_layer.objects.active = ob;
  for (const [idname, props] of [['object.mode_set', { mode: 'EDIT' }], ['mesh.select_all', { action: 'SELECT' }], ['transform.translate', { value: [0, 0, 0.002] }], ['object.mode_set', { mode: 'OBJECT' }]]) sync.blender.run(idname, props);
});
const after = await geometryOf();
for (const name of ['Plain', 'Body', 'Smooth']) {
  assert.ok(before(name), `${name} has a geometry entry`);
  assert.notEqual(after(name), before(name), `${name}: its edited vertices change its geometry entry`);
}
console.log('Export mesh edit: an edit of a mesh changes its geometry entry, whatever draws it in the app');
process.exit(0);
