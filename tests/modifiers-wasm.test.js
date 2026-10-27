import assert from 'node:assert/strict';
import fs from 'node:fs';
import { NullEngine, Scene, MeshBuilder } from '@babylonjs/core';
import { primitive_add } from '../src/editors/mesh/editmesh-add.js';
import { evaluateBlenderModifiers, evaluated, moduleModifiers, modifierPanel } from '../src/modifiers/blender.js';
import { EditMesh } from '../src/bmesh/bmesh-wasm.js';
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

// In Edit Mode: the same modifiers on the edit mesh give Blender's result, mapped back to the edit mesh's faces.
const edit = EditMesh.fromMesh(primitive_add('mesh.primitive_cube_add'), 1);
const subsurf = JSON.parse(fs.readFileSync(new URL('subsurf.json', dir)));
const final = evaluated(edit.evaluate(moduleModifiers(subsurf.stack)));
assert.deepEqual(Array.from(final.corner_verts), subsurf.corner_verts);
assert.deepEqual([...new Set(final.orig_index('FACE'))].sort(), [0, 1, 2, 3, 4, 5]);
assert.equal(edit.evaluate([]).mesh, null);
edit.free();

// Panels: Blender's own panel_draw lays them out, reading the modifier's settings.
const props = (node) => [...(node.kind === 'prop' ? [node.prop] : []), ...node.children.flatMap(props)];
const find = (node, test) => test(node) ? node : node.children.map((child) => find(child, test)).find(Boolean);
const array = modifierPanel({ type: 'ARRAY', values: { use_relative_offset: false } });
assert.deepEqual(props(array).slice(0, 2), ['fit_type', 'count']);
const relative = find(array, (n) => n.kind === 'panel' && n.prop.endsWith('relative_offset'));
assert.equal(find(relative, (n) => n.kind === 'header').children[0].prop, 'use_relative_offset');
assert.equal(find(relative, (n) => n.kind === 'column').active, false);
assert.equal(find(modifierPanel({ type: 'ARRAY', values: {} }), (n) => n.kind === 'panel' && n.prop.endsWith('relative_offset'))
  .children.find((n) => n.kind === 'body').children[0].active, true);
const unreadable = ['ARRAY', 'BEVEL', 'BUILD', 'DECIMATE', 'EDGE_SPLIT', 'MIRROR', 'REMESH', 'SCREW', 'SKIN', 'SOLIDIFY', 'SUBSURF', 'TRIANGULATE', 'WELD',
  'WIREFRAME', 'CAST', 'DISPLACE', 'SIMPLE_DEFORM', 'SMOOTH', 'CORRECTIVE_SMOOTH', 'LAPLACIANSMOOTH', 'WAVE', 'WEIGHTED_NORMAL']
  .filter((type) => !props(modifierPanel({ type, values: {} })).length);
assert.deepEqual(unreadable, [], 'Panels that draw no properties');

// In the stack: Blender's modifiers draw on the object, and Apply keeps the evaluated Mesh.
const engine = new NullEngine(), scene = new Scene(engine), box = MeshBuilder.CreateBox('Cube', { size: 2 }, scene);
box.metadata = { wbId: 'cube', wbCreation: { operator: 'mesh.primitive_cube_add', options: {} } };
const objects = [box];
objects.scene = scene;
const modifiers = createModifierSystem({ scene, objects, animation: createAnimationModel() }, { notify: (message) => { throw Error(message); } });
const subsurfModifier = modifiers.add(box, 'SUBSURF');
assert.equal(box.getTotalIndices(), 24 * 2 * 3);
modifiers.set(box, subsurfModifier.id, 'levels', 2);
assert.equal(box.getTotalIndices(), 96 * 2 * 3);
modifiers.apply(box, subsurfModifier.id);
assert.equal(box.metadata.wbCreation.mesh.face_offsets.length - 1, 96);
modifiers.dispose();
scene.dispose();
engine.dispose();
console.log(`Modifiers: ${fs.readdirSync(dir).length} stacks of Blender's modifiers match Blender 5.2, in Object and Edit Mode, in the stack and applied`);
