import assert from 'node:assert/strict';
import fs from 'node:fs';
import { blenderMain, meshFromFaces, OPERATOR_FINISHED, OPERATOR_CANCELLED } from '../src/bmesh/bmesh-wasm.js';
import { dnaGet } from '../src/makesrna/dna-struct.js';
import { hasArmatures, armatureData, armatureDrawn, setArmatureData } from '../src/blenkernel/armature/armature.js';
import { moduleModifiers } from '../src/modifiers/blender.js';
import { NullEngine, Scene, FreeCamera, Vector3 } from '@babylonjs/core';
import { createArmatureModes } from '../src/editors/armature/armature-modes.js';
import { registerObjectOperators } from '../src/editors/object/object-operators.js';
import { createContext } from '../src/blenkernel/context.js';
import { invokeOperator } from '../src/windowmanager/wm-operators.js';
import { createSelection } from '../src/editors/object/selection.js';
import { createRNA } from '../src/makesrna/rna-bylonder.js';
import { createMainSync } from '../src/blenkernel/main-sync.js';
import { createAnimationModel } from '../src/blenkernel/animation/model.js';
import { createModifierSystem, addModifier } from '../src/modifiers/stack.js';
import { createMesh } from '../src/editors/object/mesh-catalog.js';

// Armature operators run by Blender's own code in the module (Add, Edit Mode's extrude and move, Pose Mode's rotate and
// move, the Armature modifier deforming a mesh by the bones' envelopes), against Blender 5.2's result
// (tools/blender-reference/armature-fixtures.py).
if (!hasArmatures) {
  console.log('Armatures: skipped, this module has no armature-api.cc (rebuild it with tools/blender-port/blender_build.py)');
  process.exit(0);
}
const dir = new URL('./fixtures/armatures/', import.meta.url);
const STATUS = { FINISHED: OPERATOR_FINISHED, CANCELLED: OPERATOR_CANCELLED };
const ID_OB = 0x424f;
const blender = blenderMain();
const failed = [];
const close = (actual, expected, tolerance = 1e-4) => {
  const a = [actual].flat(3), e = [expected].flat(3);
  return a.length === e.length && a.every((v, i) => Math.abs(v - e[i]) < tolerance);
};
const columns = (m) => [0, 1, 2, 3].map((c) => m.slice(c * 4, c * 4 + 4));

function compare(label, ob, box, expected) {
  const mode = dnaGet('Object', ob, 'mode');
  if (mode !== expected.mode) failed.push(`${label}: mode ${mode}, Blender ${expected.mode}`);
  const { bones } = armatureData(ob), drawn = armatureDrawn(ob), editing = mode === 'EDIT';
  if (bones.length !== expected.bones.length) return failed.push(`${label}: ${bones.length} bones, Blender ${expected.bones.length}`);
  expected.bones.forEach((want, i) => {
    const bone = bones[i], keys = ['name', 'parent', 'use_connect', ...(editing ? ['select', 'select_head', 'select_tail'] : [])];
    for (const key of keys) if (bone[key] !== want[key]) failed.push(`${label}: ${want.name}.${key} ${bone[key]}, Blender ${want[key]}`);
    for (const key of ['head', 'tail', ...(editing ? ['roll'] : [])]) if (!close(bone[key], want[key])) failed.push(`${label}: ${want.name}.${key} ${bone[key]}, Blender ${want[key]}`);
    if (editing && !close(columns(drawn[i].matrix), want.matrix)) failed.push(`${label}: ${want.name}.matrix ${drawn[i].matrix}, Blender ${want.matrix.flat()}`);
  });
  if (!editing) expected.pose.forEach((want, i) => {
    const { pose } = bones[i];
    for (const key of ['location', 'rotation_quaternion', 'scale']) if (!close(pose[key], want[key])) failed.push(`${label}: pose ${want.name}.${key} ${pose[key]}, Blender ${want[key]}`);
    if (pose.select !== want.select) failed.push(`${label}: pose ${want.name}.select ${pose.select}, Blender ${want.select}`);
    if (!close(columns(drawn[i].matrix), want.matrix)) failed.push(`${label}: pose ${want.name}.matrix ${drawn[i].matrix}, Blender ${want.matrix.flat()}`);
  });
  if (expected.box) {
    const positions = Array.from(blender.evaluatedMesh(box).vert_positions);
    if (!close(positions, expected.box.positions)) failed.push(`${label}: deformed ${positions.map((v) => v.toFixed(4))}, Blender ${expected.box.positions.flat()}`);
  }
}

// The box the Armature modifier deforms, by the bones' envelopes only.
function deformed(ob, { positions, faces }) {
  const box = blender.add('MESH', 'Box');
  const offsets = [0, ...faces.map((_, i) => (i + 1) * 4)];
  blender.setMesh(box, meshFromFaces(positions.flat(), offsets, faces.flat()));
  blender.setModifiers(box, moduleModifiers([{ type: 'ARMATURE', values: { use_bone_envelopes: true, use_vertex_groups: false } }], undefined, () => ob));
  return box;
}

const files = fs.readdirSync(dir).sort();
for (const file of files) {
  const fixture = JSON.parse(fs.readFileSync(new URL(file, dir))), name = file.replace('.json', '');
  const before = new Set(blender.ids(ID_OB));
  let ob = null, box = null;
  fixture.steps.forEach((step, i) => {
    const label = `${name} ${i} ${step.operator}`;
    if (step.operator === 'deform') box = deformed(ob, fixture.box);
    else if (step.operator === 'select') {
      const data = armatureData(ob);
      data.bones.find((bone) => bone.name === step.props.bone).pose.select = true;
      setArmatureData(blender.bmain, ob, data);
    } else {
      const { status } = blender.run(step.operator, step.props);
      if (status !== STATUS[step.result[0]]) failed.push(`${label}: status ${status}, Blender ${step.result}`);
    }
    ob ??= blender.ids(ID_OB).find((id) => !before.has(id));
    blender.evaluate();
    compare(label, ob, box, step);
  });
  if (dnaGet('Object', ob, 'mode') !== 'OBJECT') blender.run('object.mode_set', { mode: 'OBJECT' });
  if (box) blender.remove(box);
  blender.remove(ob);
}
assert.deepEqual(failed, [], 'Armature results that differ from Blender');

// The data round trip: what Bylonder holds of an armature, set into Main again, reads back the same, in Object and in
// Edit Mode.
const ob = blender.add('ARMATURE', 'Armature');
blender.setBase(ob, { select: true, active: true });
const data = {
  bones: [
    { name: 'Root', parent: null, head: [0, 0, 0], tail: [0, 0, 1], roll: 0.3, pose: { rotation_quaternion: [0.9, 0.1, 0.2, 0.3], select: true } },
    { name: 'Tip', parent: 'Root', head: [0, 0, 1], tail: [0, 1, 2], roll: 0, use_connect: true, pose: { location: [0, 0.2, 0], hide: true } },
  ],
  active: 'Tip',
};
const fixed = (values) => values.map((v) => v.toFixed(5));
const held = (d) => JSON.stringify(d.bones.map(({ name, parent, head, tail, use_connect, pose }) =>
  [name, parent, fixed(head), fixed(tail), use_connect, pose.select, pose.hide, fixed(pose.location), fixed(pose.rotation_quaternion)]));
const expected = held({ bones: data.bones.map((b) => ({ use_connect: false, ...b, pose: { location: [0, 0, 0], rotation_quaternion: [1, 0, 0, 0], select: false, hide: false, ...b.pose } })) });
setArmatureData(blender.bmain, ob, data);
assert.equal(held(armatureData(ob)), expected);
assert.equal(armatureData(ob).active, 'Tip');
blender.run('object.mode_set', { mode: 'EDIT' });
assert.equal(held(armatureData(ob)), expected);
setArmatureData(blender.bmain, ob, armatureData(ob));
blender.run('object.mode_set', { mode: 'OBJECT' });
assert.equal(held(armatureData(ob)), expected);
assert.ok(Math.abs(armatureData(ob).bones[0].roll - 0.3) < 1e-5);
blender.remove(ob);

// In the app: Add > Armature, Edit Mode's extrude and move and Pose Mode's rotate run on Main through the scene sync,
// and the armature comes back to Babylon as Blender's data and drawn bones, deforming a mesh by its Armature modifier;
// Bylonder's data (an undo step's) goes back.
const scene = new Scene(new NullEngine()), objects = [];
objects.scene = scene;
const selection = createSelection(scene, objects);
const world = { scene, objects, animation: createAnimationModel() };
const rna = createRNA({ world, selection });
const sync = createMainSync({ rna });
sync.debug = true;
world.mainSync = sync;
world.modifiers = createModifierSystem(world, { notify: (message) => { throw Error(message); } });
const app = (idname, props = {}) => sync.run(() => sync.blender.run(idname, props), { meshes: sync.selected() }).status;
const steps = (name) => JSON.parse(fs.readFileSync(new URL(name + '.json', dir))).steps;
assert.equal(app('object.armature_add'), OPERATOR_FINISHED);
const node = objects.find((n) => n.metadata?.wbCreation?.armature);
assert.ok(node && selection.nodes.includes(node), 'the new armature is a selected Babylon object');
const object = rna.pointer('Object', node);
assert.equal(object.type, 'ARMATURE');
assert.equal(node.getTotalIndices(), 24, 'one octahedral bone');
app('object.mode_set', { mode: 'EDIT' });
assert.equal(object.mode, 'EDIT');
app('armature.extrude', { forked: false });
app('transform.translate', { value: [0, 0.5, 1] });
app('object.mode_set', { mode: 'POSE' });
assert.equal(object.mode, 'POSE');
const bones = () => node.metadata.wbCreation.armature.bones;
assert.deepEqual(bones().map((b) => b.name), ['Bone', 'Bone.001']);
assert.equal(node.getTotalIndices(), 48, 'two bones drawn');
const { box: boxData } = JSON.parse(fs.readFileSync(new URL('deform.json', dir)));
const boxNode = createMesh('Box', { vertices: boxData.positions, faces: boxData.faces }, scene);
objects.push(boxNode);
addModifier(boxNode, 'ARMATURE', { use_bone_envelopes: true, use_vertex_groups: false });
// As a script sets it: modifier.object is the armature's Object.
rna.pointer('Object', boxNode).modifiers[0].object = object;
assert.equal(rna.pointer('Object', boxNode).modifiers[0].object.name, node.name);
const one = structuredClone(node.metadata.wbCreation.armature);
one.bones[1].pose.select = true;
node.metadata = { ...node.metadata, wbCreation: { armature: one } };
assert.equal(app('transform.rotate', { value: 0.6, orient_axis: 'X', orient_type: 'GLOBAL' }), OPERATOR_FINISHED);
const rotated = steps('pose-rotate').at(-1).pose[1];
assert.ok(close(bones()[1].pose.rotation_quaternion, rotated.rotation_quaternion), 'the pose bone rotated as in Blender');
assert.ok(close(columns(armatureDrawn(sync.objectOf(node))[1].matrix), rotated.matrix), "and it is drawn by Blender's evaluated pose");
const deformedBox = steps('deform').at(-1).box.positions;
assert.ok(close(Array.from(sync.evaluatedMesh(boxNode).vert_positions), deformedBox), 'the Armature modifier deforms the mesh as in Blender');
// Babylon draws face corners in its axes: (x, y, z) is Blender's (x, z, y).
const drawn = boxNode.getVerticesData('position'), key = ([x, y, z]) => [x, z, y].map((v) => v.toFixed(3)).join();
const shown = new Set(Array.from({ length: drawn.length / 3 }, (_, i) => key(Array.from(drawn.slice(i * 3, i * 3 + 3)))));
assert.deepEqual([...shown].sort(), [...new Set(deformedBox.map(([x, y, z]) => key([x, z, y])))].sort(), 'and the mesh is drawn deformed');
// An undo step's data: one bone again.
node.metadata = { ...node.metadata, wbCreation: { armature: { bones: one.bones.slice(0, 1), active: null } } };
sync.flush();
assert.equal(armatureData(sync.objectOf(node)).bones.length, 1);
assert.equal(node.getTotalIndices(), 24);
assert.deepEqual(sync.check(), []);

// The modes in the app: Object Mode's operators (Blender's mode_set) for an armature, its keymaps and context mode, and
// a click on a bone selecting it with Blender's pick.
const host = { transaction: (fn) => fn(), notify: () => {}, keying: (fn) => fn(), commit: () => {}, wm: () => null, pointer: () => null, view: () => null };
registerObjectOperators({ actions: [] }, { sync, ...host });
const modes = createArmatureModes({ sync, selection, views: { pickPoint: (view, x, y) => ({ x, y }) }, options: host });
const contextMode = () => createContext(rna).mode;
assert.equal(modes.mode(), 'POSE');
assert.equal(contextMode(), 'POSE');
assert.ok(modes.keymapActive('Pose') && !modes.keymapActive('Armature') && !modes.keymapActive('Object Mode'));
invokeOperator('object.mode_set', { mode: 'EDIT', toggle: true }, null);
assert.equal(modes.mode(), 'EDIT');
assert.equal(contextMode(), 'EDIT_ARMATURE');
assert.equal(createContext(rna).edit_object.name, node.name);
invokeOperator('object.mode_set', { mode: 'EDIT', toggle: true }, null);
assert.equal(modes.mode(), 'POSE', 'Tab again goes back to Pose Mode, as in Blender');
invokeOperator('object.mode_set', { mode: 'OBJECT' }, null);
assert.equal(modes.mode(), null);
assert.ok(modes.keymapActive('Object Mode') && !modes.keymapActive('Pose'));
invokeOperator('object.mode_set', { mode: 'POSE' }, null);
const camera = new FreeCamera('Camera', new Vector3(0, 0.5, -5), scene);
camera.setTarget(new Vector3(0, 0.5, 0));
const engine = scene.getEngine(), center = { x: engine.getRenderWidth() / 2, y: engine.getRenderHeight() / 2 };
const click = (at, props = {}) => modes.selectOperator({ view: { camera }, ...at }, { deselect_all: true, ...props });
click(center);
assert.equal(bones()[0].pose.select, true, 'a click on the bone selects it');
click({ x: 1, y: 1 });
assert.equal(bones()[0].pose.select, false, 'a click on nothing deselects it');
invokeOperator('object.mode_set', { mode: 'EDIT' }, null);
click(center);
assert.ok(bones()[0].select && bones()[0].select_head && bones()[0].select_tail, 'in Edit Mode the whole bone');
invokeOperator('object.mode_set', { mode: 'OBJECT' }, null);

console.log(`Armatures: ${files.length} cases match Blender 5.2 (add, Edit Mode extrude and move, Pose Mode rotate and move, the Armature modifier); data round trip; scene sync, modes and bone picking`);
