// A Geometry Nodes result draws with the material its Set Material assigns, as Blender's engines draw an evaluated
// object's slots (BKE_object_material_get_eval): the object itself has no slot, and keeps none.
import assert from 'node:assert/strict';
import { NullEngine, Scene, MeshBuilder } from '@babylonjs/core';
import { createSelection } from '../src/editors/object/selection.js';
import { OPERATOR_FINISHED } from '../src/bmesh/bmesh-wasm.js';
import { contextStruct, idStruct, inPythonContext, setContextPointer } from '../src/python/bpy_rna.js';
import { sceneMain } from './scene-main.js';
import { createModifierSystem } from '../src/modifiers/stack.js';

const scene = new Scene(new NullEngine()), objects = [];
objects.scene = scene;
const world = { scene, objects };
world.modifiers = createModifierSystem(world, { notify: (message) => { throw Error(message); } });
const cube = MeshBuilder.CreateBox('Cube', { size: 2 }, scene);
cube.metadata = { wbId: 'cube', wbCreation: { operator: 'mesh.primitive_cube_add', options: {} } };
objects.push(cube);
const selection = createSelection(scene, objects);
const sync = sceneMain(world, selection), { blender } = sync;
setContextPointer(blender.C);
selection.replace([cube]);
sync.redraw();
const run = (idname, props = {}) => assert.equal(sync.run(() => blender.run(idname, props), { meshes: [cube] }).status, OPERATOR_FINISHED, idname);

// Its Geometry Nodes set a material on the cube's mesh.
run('object.modifier_add', { type: 'NODES' });
run('node.new_geometry_node_group_assign');
const painted = inPythonContext(blender.C, () => contextStruct().blend_data.materials.new('Painted'));
const { nodes, links } = idStruct(sync.objectOf(cube)).modifiers.active.node_group;
const paint = nodes.new('GeometryNodeSetMaterial');
paint.inputs.get('Material').default_value = painted;
links.new(nodes.get('Group Input').outputs[0], paint.inputs.get('Geometry'));
links.new(paint.outputs[0], nodes.get('Group Output').inputs[0]);
sync.redraw();

assert.deepEqual(blender.materials(sync.objectOf(cube)), [], 'the object has no slot of its own');
assert.equal(cube.material?.name, 'Painted', 'its evaluated mesh draws with the material Set Material assigns');
console.log('Geometry Nodes material: a Set Material result draws with its material, the object keeping its own slots');
