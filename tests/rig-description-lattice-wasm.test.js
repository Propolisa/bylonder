// A lattice in a rig's description, as the native rig runtime reads it: its object's vertex groups (each point's
// weight) and its Hook modifiers' settings and vertex indices. The Rigged Character's body, on the runtime for an Action
// constraint, deformed by a lattice parented to its chest whose top points a Hook on the head pulls (as Snow's face
// mask), deforms in the page as Main's: the runtime runs the Hook, and places the lattice, which the page does not draw,
// by its parent bone.
import assert from 'node:assert/strict';
import { blendData, contextStruct } from '../src/python/bpy_rna.js';
import { rigDescription } from '../src/io_scene_babylon/rig-description.js';
import { exportModule } from '../src/io_scene_babylon/js-export.js';
import { subscribeReports } from '../src/windowmanager/wm-reports.js';
import { NullEngine, VertexBuffer } from '@babylonjs/core';
import { writePackage } from './export-package.js';
import { openExample } from './open-example.js';

const { world, sync } = openExample('rigged-character');
const data = blendData(), C = contextStruct(), rig = data.objects.get('Rig'), body = data.objects.get('Body');
Object.assign(rig.pose.bones.get('chest').constraints.new('ACTION'), { use_eval_time: true, eval_time: 0.5, frame_start: 1, frame_end: 21,
  use_bone_object_action: false }).action = rig.animation_data.action;
// A twin the skeleton skins, as the rig's skeleton lives on its skinned meshes.
const twin = data.objects.new('Twin', body.data);
C.scene.collection.objects.link(twin);
Object.assign(twin, { parent: body.parent, matrix_parent_inverse: body.matrix_parent_inverse, location: body.location, rotation_euler: body.rotation_euler, scale: body.scale });
twin.modifiers.new('Armature', 'ARMATURE').object = rig;
const lattice = data.lattices.new('Cage'), cage = data.objects.new('Cage', lattice);
C.scene.collection.objects.link(cage);
Object.assign(cage, { location: [0, 0, 1], scale: [4, 4, 4] });
sync.view();
const placed = Array.from(cage.matrix_world);
Object.assign(cage, { parent: rig, parent_type: 'BONE', parent_bone: 'chest' });
sync.view();
cage.matrix_world = placed;
const top = cage.vertex_groups.new('Top'), TOP = [4, 5, 6, 7];
top.add(TOP, 0.75, 'REPLACE');
Object.assign(cage.modifiers.new('Hook Top', 'HOOK'), { object: rig, subtarget: 'head', vertex_group: 'Top' });
Object.assign(body.modifiers.new('Cage', 'LATTICE'), { object: cage });
sync.blender.tag(sync.objectOf(world.objects.find((n) => n.name === 'Rig')), 2);
sync.view();

const key = sync.objectOf(world.objects.find((n) => n.name === 'Body'));
const described = rigDescription(rig, [body], () => sync.blender.mesh(key)).objects.find((o) => o.name === 'Cage');
const weights = described.data.vertex_groups.find((g) => g.name === 'Top').weights;
assert.deepEqual(weights.map((w, i) => (w ? i : -1)).filter((i) => i >= 0), TOP, 'the group holds the points assigned');
assert.ok(TOP.every((i) => Math.abs(weights[i] - 0.75) < 1e-6), 'with their weight');
const hook = described.modifiers.find((m) => m.type === 'HOOK');
assert.deepEqual([hook.object, hook.subtarget, hook.vertex_group, hook.vertex_indices], ['Rig', 'head', 'Top', []], "the Hook's settings, by group and no indices");

const reports = [];
subscribeReports((r) => reports.push(r));
const files = await exportModule(world);
const entity = Object.values(JSON.parse(files['scene.ir.json']).entities).find((e) => e.type === 'constraints:POSE');
assert.equal(entity?.implementation, 'native-rig', JSON.stringify(reports.filter((r) => r.type !== 'INFO').map((r) => r.message)));
assert.ok(!reports.some((r) => /native rig runtime does not run/.test(r.message)), 'the runtime runs every step');
assert.ok(Object.keys(entity.inputs.native.meshes).includes('Body'), 'the body deforms on the runtime');

const written = writePackage(files);
const blend = await (await import(written.url)).load(new NullEngine());
await blend.settled();
blend.playhead.pause();
const frame = blend.controls().find((c) => c.path.endsWith('.frame_current')).path, drawn = blend.scene.getMeshByName('Body');
for (const f of [1, 11, 21]) {
  blend.set(frame, f);
  for (let i = 0; i < 2; i++) { blend.scene.render(); await blend.settled(); }
  sync.frameChanged(f);
  const mesh = sync.blender.evaluatedMesh(key), p = mesh.vert_positions;
  const theirs = [...mesh.corner_verts].flatMap((v) => [p[v * 3], p[v * 3 + 2], p[v * 3 + 1]]), ours = drawn.getVerticesData(VertexBuffer.PositionKind);
  const error = Math.max(...theirs.map((v, i) => Math.abs(v - ours[i])));
  // The runtime's deform of this body is within 7.5 mm of Main's at its left elbow (export-native-rig-wasm.test.js),
  // 12 mm through the lattice.
  assert.ok(error < 1.5e-2, `frame ${f}: the body is off Main's by ${error}`);
}
blend.dispose();
written.remove();
console.log("Rig description lattice: a lattice's vertex groups and Hooks are described, and a bone-parented lattice with a Hook deforms the body in the page as Main's");
process.exit(0);
