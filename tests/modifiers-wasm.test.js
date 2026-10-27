import assert from 'node:assert/strict';
import fs from 'node:fs';
import { NullEngine, Scene, MeshBuilder } from '@babylonjs/core';
import { primitive_add } from '../src/editors/mesh/editmesh-add.js';
import { evaluateBlenderModifiers } from '../src/modifiers/blender.js';
import { createModifierSystem } from '../src/modifiers/stack.js';
import { createAnimationModel } from '../src/blenkernel/animation/model.js';

// Blender's modifiers evaluated by Blender's code in the module, against Blender 5.2's result on a default cube
// (tools/blender-reference/modifier-fixtures.py).
const dir = new URL('./fixtures/modifiers/', import.meta.url);
const failed = [];
for (const file of fs.readdirSync(dir).sort()) {
  const fixture = JSON.parse(fs.readFileSync(new URL(file, dir)));
  try {
    const mesh = evaluateBlenderModifiers(primitive_add('mesh.primitive_cube_add'), fixture.stack);
    const positions = Array.from(mesh.vert_positions);
    const differs = (key, actual, expected) => JSON.stringify(Array.from(actual)) !== JSON.stringify(expected) && `${key} differ`;
    const problem = (positions.length !== fixture.positions.length * 3 && `${positions.length / 3} verts, Blender ${fixture.positions.length}`) ||
      differs('edges', mesh.edges, fixture.edges.flat()) || differs('faces', mesh.face_offsets, fixture.face_offsets) ||
      differs('corners', mesh.corner_verts, fixture.corner_verts) ||
      (fixture.positions.flat().some((v, i) => Math.abs(v - positions[i]) > 1e-4) && 'positions differ');
    if (problem) failed.push(`${file}: ${problem}`);
  } catch (error) {
    failed.push(`${file}: ${error.message}`);
  }
}
assert.deepEqual(failed, [], 'Modifier results that differ from Blender');

// In the stack: Blender's modifiers draw on the object, and Apply keeps the evaluated Mesh.
const engine = new NullEngine(), scene = new Scene(engine), box = MeshBuilder.CreateBox('Cube', { size: 2 }, scene);
box.metadata = { wbId: 'cube', wbCreation: { operator: 'mesh.primitive_cube_add', options: {} } };
const objects = [box];
objects.scene = scene;
const modifiers = createModifierSystem({ scene, objects, animation: createAnimationModel() }, { notify: (message) => { throw Error(message); } });
const subsurf = modifiers.add(box, 'SUBSURF');
assert.equal(box.getTotalIndices(), 24 * 2 * 3);
modifiers.set(box, subsurf.id, 'levels', 2);
assert.equal(box.getTotalIndices(), 96 * 2 * 3);
modifiers.apply(box, subsurf.id);
assert.equal(box.metadata.wbCreation.mesh.face_offsets.length - 1, 96);
modifiers.dispose();
scene.dispose();
engine.dispose();
console.log(`Modifiers: ${fs.readdirSync(dir).length} stacks of Blender's modifiers match Blender 5.2, in the stack and applied`);
