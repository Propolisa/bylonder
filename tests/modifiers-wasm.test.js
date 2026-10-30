import assert from 'node:assert/strict';
import fs from 'node:fs';
import { NullEngine, Scene, MeshBuilder, Matrix } from '@babylonjs/core';
import { primitive_add } from '../src/editors/mesh/editmesh-add.js';
import { evaluateBlenderModifiers, moduleModifiers } from '../src/modifiers/blender.js';
import { BlenderMain } from '../src/bmesh/bmesh-wasm.js';
import { createModifierSystem } from '../src/modifiers/stack.js';
import { createAnimationModel } from '../src/blenkernel/animation/model.js';
import { createMesh, createPrimitive, shadeSmooth } from '../src/editors/object/mesh-catalog.js';
import { hasMesh } from '../src/editors/object/identity.js';
import { mesh_deserialize } from '../src/blenkernel/mesh/mesh.js';
import { sceneMain } from './scene-main.js';

// Blender's modifiers evaluated by Blender's code in the module, against Blender 5.2's result on a default cube
// (tools/blender-reference/modifier-fixtures.py).
const dir = new URL('./fixtures/modifiers/', import.meta.url);
// Results known to differ, with the reason.
const KNOWN = {
  'remesh.json': "edge order: mesh_calc_edges splits its work by Blender's thread count, one in the module",
};
// Stacks Bylonder does not offer yet, so not run.
const SKIPPED = {
  'remesh-blocks.json': "Remesh's Dual Contouring modes give faces of vertices they do not make",
  'remesh-smooth.json': "Remesh's Dual Contouring modes give faces of vertices they do not make",
};
const failed = [], known = [];
for (const file of fs.readdirSync(dir).sort().filter((name) => !SKIPPED[name])) {
  const fixture = JSON.parse(fs.readFileSync(new URL(file, dir)));
  try {
    const mesh = evaluateBlenderModifiers(primitive_add('mesh.primitive_cube_add'), fixture.stack);
    const positions = Array.from(mesh.vert_positions);
    const differs = (key, actual, expected) => JSON.stringify(Array.from(actual)) !== JSON.stringify(expected) && `${key} differ`;
    const problem = (positions.length !== fixture.positions.length * 3 && `${positions.length / 3} verts, Blender ${fixture.positions.length}`) ||
      differs('edges', mesh.edges, fixture.edges.flat()) || differs('faces', mesh.face_offsets, fixture.face_offsets) ||
      differs('corners', mesh.corner_verts, fixture.corner_verts) ||
      (fixture.positions.flat().some((v, i) => Math.abs(v - positions[i]) > 1e-4) && 'positions differ');
    if (problem) (KNOWN[file] ? known : failed).push(`${file}: ${problem}`);
  } catch (error) {
    failed.push(`${file}: ${error.message}`);
  }
}
assert.deepEqual(failed, [], 'Modifier results that differ from Blender');
assert.equal(known.length, Object.keys(KNOWN).length, 'A known difference is gone: remove it from KNOWN');

// In Edit Mode on Main: the same modifiers on the edit mesh give Blender's result.
const main = new BlenderMain(), ob = main.add('MESH', 'Cube');
const subsurf = JSON.parse(fs.readFileSync(new URL('subsurf.json', dir)));
main.setMesh(ob, primitive_add('mesh.primitive_cube_add'));
main.setModifiers(ob, moduleModifiers(subsurf.stack));
main.setBase(ob, { select: true, active: true });
main.run('object.mode_set', { mode: 'EDIT' });
main.evaluate();
const final = main.evaluatedMesh(ob);
assert.deepEqual(Array.from(final.corner_verts), subsurf.corner_verts);
main.run('object.mode_set', { mode: 'OBJECT' });
main.remove(ob);

// In the stack: Main's depsgraph evaluates Blender's modifiers, the object draws the result, and Apply keeps it.
const engine = new NullEngine(), scene = new Scene(engine), box = MeshBuilder.CreateBox('Cube', { size: 2 }, scene);
box.metadata = { wbId: 'cube', wbCreation: { operator: 'mesh.primitive_cube_add', options: {} } };
// A world whose objects' Mesh data is Main's, and its modifier stacks.
const mainWorld = (objects) => {
  const world = { scene, objects: Object.assign(objects, { scene }), animation: createAnimationModel() };
  const stacks = world.modifiers = createModifierSystem(world, { notify: (message) => { throw Error(message); } });
  sceneMain(world);
  return stacks;
};
const modifiers = mainWorld([box]);
const subsurfModifier = modifiers.add(box, 'SUBSURF');
assert.equal(box.getTotalIndices(), 24 * 2 * 3);
modifiers.set(box, subsurfModifier.id, 'levels', 2);
assert.equal(box.getTotalIndices(), 96 * 2 * 3);
modifiers.apply(box, subsurfModifier.id);
assert.equal(box.metadata.wbCreation.mesh.face_offsets.length - 1, 96);
modifiers.dispose();

// Mesh data from code (Mesh.from_pydata): a profile of loose edges is a mesh object Screw turns into faces, and Shade
// Smooth draws a primitive's subdivided faces with vertex normals.
const profile = [[0.3, 0, 0], [0.5, 0, 0.4], [0.2, 0, 1]];
const vase = createMesh('Vase', { vertices: profile, edges: [[0, 1], [1, 2]] }, scene);
vase.metadata.wbId = 'vase';
assert.ok(hasMesh(vase) && vase.getTotalVertices() === 0, 'loose edges only');
const cube = shadeSmooth(createPrimitive('Smooth', 'mesh.primitive_cube_add', { size: 2 }, scene));
assert.equal(mesh_deserialize(cube.metadata.wbCreation.mesh).attribute('sharp_face'), undefined);
const lathe = mainWorld([vase]);
lathe.add(vase, 'SCREW', { steps: 8 });
await lathe.settled();
assert.equal(vase.getTotalIndices(), 8 * 2 * 6, 'Screw makes two quads per step');
assert.ok(vase.getChildMeshes(true).every((wire) => !wire.isEnabled(false)), 'the profile\'s loose edges do not draw over the result');
lathe.dispose();
console.log('Modifiers: Screw turns a profile of edges from code, Shade Smooth clears sharp faces');

// Thin instances placed by code stay: the evaluated mesh draws in each of them.
engine.getCaps().instancedArrays = true;
const studs = createPrimitive('Studs', 'mesh.primitive_cube_add', { size: 0.2 }, scene);
studs.metadata.wbId = 'studs';
studs.thinInstanceAdd([0, 1, 2].map((x) => Matrix.Translation(x, 0, 0)));
const placed = mainWorld([studs]);
const bevel = placed.add(studs, 'BEVEL', { width: 0.02 });
await placed.settled();
assert.equal(studs.thinInstanceCount, 3, 'instances survive the evaluation');
assert.deepEqual(studs.thinInstanceGetWorldMatrices().map((m) => m.m[12]), [0, 1, 2]);
placed.remove(studs, bevel.id);
await placed.settled();
assert.equal(studs.thinInstanceCount, 3, 'and removing the modifier keeps them');
placed.dispose();
console.log('Modifiers: thin instances from code keep drawing the evaluated mesh');
scene.dispose();
engine.dispose();
console.log(`Modifiers: ${known.length} results differ where known (${Object.values(KNOWN).join('; ')})`);
console.log(`Modifiers: ${Object.keys(SKIPPED).length} stacks not offered yet (${[...new Set(Object.values(SKIPPED))].join('; ')})`);
console.log(`Modifiers: ${fs.readdirSync(dir).length - known.length - Object.keys(SKIPPED).length} stacks of Blender's modifiers match Blender 5.2, in Object and Edit Mode, evaluated by Main's depsgraph and applied`);
