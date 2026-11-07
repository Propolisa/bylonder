// Geometry nodes' instances as the view draws them (main-api.cc main_instances, read from the evaluated Instances) are
// Blender's dupli list's (object_duplilist, as Depsgraph.object_instances iterates it): an instance of instances, a
// realized branch that becomes the object's own mesh, and an object instanced by Object Info.
import assert from 'node:assert/strict';
import { NullEngine, Scene, MeshBuilder } from '@babylonjs/core';
import { OPERATOR_FINISHED } from '../src/bmesh/bmesh-wasm.js';
import { createModifierSystem } from '../src/modifiers/stack.js';
import { createAnimationModel } from '../src/blenkernel/animation/model.js';
import { contextStruct, idStruct, inPythonContext, setContextPointer } from '../src/python/bpy_rna.js';
import { createSelection } from '../src/editors/object/selection.js';
import { sceneMain } from './scene-main.js';

const engine = new NullEngine(), scene = new Scene(engine);
const box = MeshBuilder.CreateBox('Cube', { size: 2 }, scene), other = MeshBuilder.CreateBox('Other', { size: 0.5 }, scene);
box.metadata = { wbId: 'cube', wbCreation: { operator: 'mesh.primitive_cube_add', options: {} } };
other.metadata = { wbId: 'other', wbCreation: { operator: 'mesh.primitive_cube_add', options: { size: 0.5 } } };
other.position.set(3, 0, 0);
const world = { scene, objects: Object.assign([box, other], { scene }), animation: createAnimationModel() };
world.modifiers = createModifierSystem(world, { notify: (message) => { throw Error(message); } });
const selection = createSelection(scene, world.objects);
const sync = sceneMain(world, selection), { blender } = sync;
setContextPointer(blender.C);
const python = (fn) => inPythonContext(blender.C, () => fn(contextStruct()));
selection.replace([box]);
const run = (idname, props) => {
  const result = sync.run(() => blender.run(idname, props), { meshes: [box] });
  assert.equal(result.status, OPERATOR_FINISHED, `${idname}: ${result.report}`);
};
run('object.modifier_add', { type: 'NODES' });
run('node.new_geometry_node_group_assign');
const ob = sync.objectOf(box), group = idStruct(ob).modifiers.active.node_group, nodes = group.nodes, links = group.links;
const add = (type, settings = {}) => Object.assign(nodes.new(type), settings);
const input = (node, name, value) => { node.inputs.get(name).default_value = value; };

// Spheres on the cube's corners, scaled and rotated, instanced again on a 3 by 3 grid: an instance of instances.
const corners = add('GeometryNodeMeshToPoints'), sphere = add('GeometryNodeMeshIcoSphere'), inner = add('GeometryNodeInstanceOnPoints');
const grid = add('GeometryNodeMeshGrid'), gridPoints = add('GeometryNodeMeshToPoints'), outer = add('GeometryNodeInstanceOnPoints');
input(inner, 'Scale', [0.2, 0.3, 0.4]);
input(inner, 'Rotation', [0.3, 0.2, 0.1]);
input(grid, 'Size X', 8);
input(grid, 'Size Y', 8);
input(outer, 'Rotation', [0, 0, 0.5]);
input(outer, 'Scale', [0.5, 0.5, 0.5]);
links.new(nodes.get('Group Input').outputs[0], corners.inputs.get('Mesh'));
links.new(corners.outputs[0], inner.inputs.get('Points'));
links.new(sphere.outputs.get('Mesh'), inner.inputs.get('Instance'));
links.new(grid.outputs.get('Mesh'), gridPoints.inputs.get('Mesh'));
links.new(gridPoints.outputs[0], outer.inputs.get('Points'));
links.new(inner.outputs[0], outer.inputs.get('Instance'));
// A realized copy of the spheres (the object's own mesh) and Other instanced on the cube's corners (Object Info).
const realize = add('GeometryNodeRealizeInstances'), info = add('GeometryNodeObjectInfo'), objects = add('GeometryNodeInstanceOnPoints');
const join = add('GeometryNodeJoinGeometry');
python(() => { info.inputs.get('Object').default_value = idStruct(sync.objectOf(other)); });
input(info, 'As Instance', true);
links.new(inner.outputs[0], realize.inputs[0]);
links.new(corners.outputs[0], objects.inputs.get('Points'));
links.new(info.outputs.get('Geometry'), objects.inputs.get('Instance'));
for (const geometry of [outer.outputs[0], realize.outputs[0], objects.outputs[0]]) links.new(geometry, join.inputs[0]);
links.new(join.outputs[0], nodes.get('Group Output').inputs[0]);
sync.redraw();

// Blender's dupli list and the view's instances, each world matrix by the object or mesh it instances.
const round = (values) => JSON.stringify(Array.from(values, (v) => Math.round(v * 1e4) / 1e4 + 0));
const byKey = (entries) => entries.reduce((map, [key, matrix]) => map.set(key, [...(map.get(key) ?? []), round(matrix)]), new Map());
const expected = byKey(blender.duplis(ob).map(({ ob: instanced, data, matrix }) => [instanced ? 'object ' + instanced : 'mesh ' + data, matrix]));
const drawn = byKey(blender.instances().flatMap((group) => Array.from({ length: group.data.length / 16 }, (_, i) =>
  [group.shape === 'MESH' ? 'mesh ' + group.geometry : 'object ' + group.ob, group.data.subarray(i * 16, i * 16 + 16)])));
assert.equal([...expected.values()].flat().length, 9 * 8 + 8, "the dupli list has 72 nested spheres and Other at 8 corners");
assert.deepEqual(new Set(drawn.keys()), new Set(expected.keys()), 'the same instanced meshes');
for (const [key, matrices] of expected) assert.deepEqual([...drawn.get(key)].sort(), [...matrices].sort(), `instances of ${key} where Blender places them`);
assert.equal(blender.evaluatedMesh(ob).faces_num, 8 * 20, "the realized spheres are the object's own mesh");
// A group's data stays readable after a call that grows the module's memory (the view draws each group's mesh first).
const [first] = blender.instances(), { memory } = (await import('../src/bmesh/bmesh-wasm.js')).blenderModule.exports, before = Array.from(first.data);
memory.grow(1);
assert.deepEqual(Array.from(first.data), before, "a group's data is read anew after the module's memory grew");
console.log("Instances: an instance of instances, Object Info's object and a realized branch drawn where Blender's dupli list places them");

// Solid shading (Workbench) lights the instances as it lights objects, in their material's Viewport Display color.
const { createWorkbench } = await import('../src/draw/workbench.js');
const { FreeCamera, Vector3 } = await import('@babylonjs/core');
const workbench = createWorkbench(scene), camera = new FreeCamera('camera', new Vector3(0, 0, -10), scene);
workbench.setShading(camera, 'solid');
const carriers = scene.meshes.filter((mesh) => mesh.name.startsWith('__instances'));
assert.ok(carriers.length, 'the view draws instances');
for (const carrier of carriers) assert.equal(carrier.getMaterialForRenderPass(camera.renderPassId)?.name, '__workbenchSolid', `${carrier.name} is shaded by Workbench in Solid`);
// Wireframe draws each instance's edges, and a selected instancer outlines its instances (overlay_outline.cc).
workbench.setShading(camera, 'wire');
scene.activeCamera = camera;
scene.render();
for (const carrier of carriers) {
  const lines = scene.meshes.find((mesh) => mesh.name === '__wire ' + carrier.name);
  assert.equal(lines?.thinInstanceCount, carrier.thinInstanceCount, `${carrier.name}'s wires at each instance`);
  assert.deepEqual(carrier.metadata.instancers, [box], 'the cube instances them');
}
workbench.dispose();
console.log('Instances: Solid shading lights them as it lights objects, Wireframe draws their edges');
