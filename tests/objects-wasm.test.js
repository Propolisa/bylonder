import assert from 'node:assert/strict';
import fs from 'node:fs';
import { BlenderMain, OPERATOR_FINISHED, OPERATOR_CANCELLED } from '../src/bmesh/bmesh-wasm.js';
import { primitive_add } from '../src/editors/mesh/editmesh-add.js';
import { createMesh, mesh_serialize } from '../src/blenkernel/mesh/mesh.js';
import { NullEngine, Scene, Vector3 } from '@babylonjs/core';
import { buildMesh } from '../src/editors/object/mesh-catalog.js';
import { createSelection } from '../src/editors/object/selection.js';
import { createRNA } from '../src/makesrna/rna-bylonder.js';
import { createMainSync } from '../src/blenkernel/main-sync.js';
import { createAnimationModel } from '../src/blenkernel/animation/model.js';

// Object Mode operators run by Blender's own code in the module, against Blender 5.2's result on the same scene
// (tools/blender-reference/object-fixtures.py).
const dir = new URL('./fixtures/objects/', import.meta.url);
const STATUS = { FINISHED: OPERATOR_FINISHED, CANCELLED: OPERATOR_CANCELLED };
const cube = primitive_add('mesh.primitive_cube_add');
const blender = new BlenderMain();
const failed = [], operators = new Set();

function build({ objects, cursor, before }) {
  const made = {};
  for (const spec of objects) {
    const ob = (made[spec.name] = blender.add(spec.type, spec.name));
    const { location, rotation_mode, scale } = spec, quaternion = rotation_mode === 'QUATERNION';
    blender.setTransform(ob, { location, rotation_mode, scale, rotation_euler: quaternion ? [0, 0, 0] : spec.rotation_euler,
      rotation_quaternion: quaternion ? spec.rotation_quaternion : [1, 0, 0, 0] });
    blender.setParent(ob, made[spec.parent]);
    if (spec.type === 'MESH') {
      const { positions } = before.find((state) => state.name === spec.name);
      blender.setMesh(ob, createMesh({ ...cube, attributes: Object.fromEntries(cube.attributes), vert_positions: Float32Array.from(positions.flat()) }));
    }
  }
  const selected = objects.filter((spec) => spec.select ?? true);
  for (const spec of objects) blender.setBase(made[spec.name], { select: selected.includes(spec), active: spec === selected.at(-1) });
  blender.cursor = cursor;
  blender.evaluate();
  return made;
}

const close = (actual, expected, tolerance = 1e-4) => [actual].flat(2).every((v, i) => Math.abs(v - [expected].flat(2)[i]) < tolerance);
function compare(name, made, states) {
  for (const expected of states) {
    const ob = made[expected.name], { matrix_world, matrix_parent_inverse, ...transform } = blender.transform(ob);
    const actual = { ...transform, matrix_world: [0, 1, 2, 3].map((c) => matrix_world.slice(c * 4, c * 4 + 4)),
      matrix_parent_inverse: [0, 1, 2, 3].map((c) => matrix_parent_inverse.slice(c * 4, c * 4 + 4)) };
    if (expected.positions) {
      const mesh = blender.mesh(ob);
      Object.assign(actual, { positions: Array.from(mesh.vert_positions), corner_verts: Array.from(mesh.corner_verts) });
    }
    for (const key of ['location', 'rotation_euler', 'rotation_quaternion', 'scale', 'matrix_parent_inverse', 'matrix_world', 'positions', 'corner_verts'])
      if (key in expected && !close(actual[key], expected[key])) failed.push(`${name}: ${expected.name}.${key} ${JSON.stringify(actual[key])}, Blender ${JSON.stringify(expected[key])}`);
  }
}

for (const file of fs.readdirSync(dir).sort()) {
  const fixture = JSON.parse(fs.readFileSync(new URL(file, dir)));
  const name = file.replace('.json', ''), made = build(fixture);
  operators.add(fixture.operator);
  compare(`${name} (before)`, made, fixture.before);
  const { status } = blender.run(fixture.operator, fixture.props);
  if (status !== STATUS[fixture.result[0]]) failed.push(`${name}: status ${status}, Blender ${fixture.result}`);
  blender.evaluate();
  compare(name, made, fixture.after);
  for (const ob of Object.values(made)) blender.setParent(ob, null);
  for (const ob of Object.values(made)) blender.remove(ob);
}
assert.deepEqual(failed, [], 'Object operator results that differ from Blender');
console.log(`Object Mode: ${fs.readdirSync(dir).length} results of ${operators.size} operators (${[...operators].join(', ')}) match Blender 5.2`);

// In the app: Bylonder's objects go in through the scene sync and come back, so applying a parent's transform keeps where
// its vertices and its child are (a parent scaled unevenly would leave the child sheared, which only Blender's parent
// inverse holds), and clearing goes through Blender's operator too.
const scene = new Scene(new NullEngine()), objects = [];
const box = (name, position, rotation, scaling) => {
  const node = buildMesh(scene, name, { mesh: mesh_serialize(cube) });
  node.metadata = { wbCreation: { mesh: mesh_serialize(cube) } };
  Object.assign(node, { position: new Vector3(...position), rotation: new Vector3(...rotation), scaling: new Vector3(...scaling) });
  objects.push(node);
  return node;
};
const parent = box('Parent', [1, 2, 3], [0.3, 0.5, 0.7], [2, 2, 2]), child = box('Child', [2, 0, 0], [0, 0.2, 0], [1, 2, 1]);
child.parent = parent;
const selection = createSelection(scene, objects);
const sync = createMainSync({ rna: createRNA({ world: { scene, objects, animation: createAnimationModel() }, selection }) });
sync.debug = true;
const app = {
  poll: (idname) => { sync.flush(); return sync.blender.poll(idname); },
  run: (idname, props) => sync.run(() => sync.blender.run(idname, props), { meshes: sync.selected() }),
};
const worldPositions = (node) => {
  const m = node.computeWorldMatrix(true), p = node.getVerticesData('position');
  return Array.from({ length: p.length / 3 }, (_, i) => Vector3.TransformCoordinates(Vector3.FromArray(p, i * 3), m).asArray()).flat();
};
const [vertices, childWorld] = [worldPositions(parent), Array.from(child.computeWorldMatrix(true).m)];
selection.replace([parent]);
assert(app.poll('object.transform_apply'));
assert.equal(app.run('object.transform_apply').status, OPERATOR_FINISHED);
assert(parent.computeWorldMatrix(true).isIdentity());
assert(close(worldPositions(parent), vertices), "the parent's vertices stay where they were");
// The module's floats, decomposed into the child's own transform.
assert(close(Array.from(child.computeWorldMatrix(true).m), childWorld, 1e-3), 'its child stays where it was');
selection.replace([child]);
app.run('object.location_clear');
assert.deepEqual(child.position.asArray(), [0, 0, 0]);
