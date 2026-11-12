// A lattice in a rig's description, as the native rig runtime reads it: its object's vertex groups (each point's
// weight) and its Hook modifiers' settings and vertex indices; and a step of a lattice's own stack the runtime does not
// run is reported by the export: the Rigged Character's body, on the runtime for an Action constraint, deformed by a
// lattice whose top points a Hook on the head pulls (as Snow's face mask).
import assert from 'node:assert/strict';
import { blendData, contextStruct } from '../src/python/bpy_rna.js';
import { rigDescription } from '../src/io_scene_babylon/rig-description.js';
import { exportModule } from '../src/io_scene_babylon/js-export.js';
import { subscribeReports } from '../src/windowmanager/wm-reports.js';
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
cage.scale = [2, 2, 2];
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
assert.ok(reports.some((r) => r.type === 'WARNING' && r.message === "Body: the native rig runtime does not run Cage's HOOK modifier, so the lattice deforms it without it"),
  JSON.stringify(reports.map((r) => r.message)));
console.log("Rig description lattice: a lattice's vertex groups and Hooks are described, and a Hook the runtime does not run is reported");
process.exit(0);
