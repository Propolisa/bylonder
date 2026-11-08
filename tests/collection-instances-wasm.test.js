// A collection instance of an object whose Geometry Nodes make instances draws those instances too, as Blender's dupli
// list nests them (make_duplis_geometry_set_impl under a collection's duplis): Pizza Delivery's far sidewalk.
import assert from 'node:assert/strict';
import { NullEngine, Scene, MeshBuilder } from '@babylonjs/core';
import { createSelection } from '../src/editors/object/selection.js';
import { OPERATOR_FINISHED } from '../src/bmesh/bmesh-wasm.js';
import { contextStruct, idStruct, inPythonContext, setContextPointer } from '../src/python/bpy_rna.js';
import { sceneMain } from './scene-main.js';
import { createModifierSystem } from '../src/modifiers/stack.js';
import { createExtrasOverlay } from '../src/draw/overlay-extra.js';

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

// The cube's Geometry Nodes put an Ico Sphere on each of its 8 corners.
run('object.modifier_add', { type: 'NODES' });
run('node.new_geometry_node_group_assign');
const { nodes, links } = idStruct(sync.objectOf(cube)).modifiers.active.node_group;
const points = nodes.new('GeometryNodeInstanceOnPoints'), sphere = nodes.new('GeometryNodeMeshIcoSphere');
links.new(nodes.get('Group Input').outputs[0], points.inputs.get('Points'));
links.new(sphere.outputs.get('Mesh'), points.inputs.get('Instance'));
links.new(points.outputs[0], nodes.get('Group Output').inputs[0]);
// An empty instancing a collection that holds the cube.
const empty = inPythonContext(blender.C, () => {
  const C = contextStruct(), set = C.blend_data.collections.new('Set');
  set.objects.link(idStruct(sync.objectOf(cube)));
  const ob = C.blend_data.objects.new('Instancer', null);
  Object.assign(ob, { instance_type: 'COLLECTION', instance_collection: set });
  C.scene.collection.objects.link(ob);
  return ob;
});
sync.redraw();

const instancer = blender.ids(0x424f).find((ob) => blender.name(ob) === 'Instancer');
const meshes = blender.instances().filter((group) => group.instancer === instancer && group.shape === 'MESH');
assert.ok(empty && instancer, 'the instancer is in Main');
assert.equal(meshes.reduce((sum, group) => sum + group.data.length / 16, 0), 8, "the instanced cube's 8 spheres are drawn");
// Add > Camera into an instanced collection that is also in the view layer and active, as Pizza Delivery's pavement:
// the camera is instanced too, and draws as no light.
inPythonContext(blender.C, () => {
  const C = contextStruct(), set = C.blend_data.collections.get('Set');
  C.scene.collection.children.link(set);
  C.view_layer.active_layer_collection = C.view_layer.layer_collection.children.get('Set');
  C.blend_data.objects.get('Instancer').location.x = 5;
});
run('object.camera_add', { rotation: [1.1, 0, 0.7] });
sync.redraw();
const camera = blender.ids(0x424f).find((ob) => blender.name(ob) === 'Camera');
assert.ok(blender.instances().some((group) => group.ob === camera), 'the camera is instanced');
// The extras overlay draws the camera where it is and at its instance, in its instancer's place.
const overlay = createExtrasOverlay(scene, { objects: () => objects, instances: sync.cameraInstances });
overlay.setEnabled(true);
const frames = overlay.meshes.filter((mesh) => mesh.metadata.extra.shape === 'camera_frame' && mesh.metadata.extra.entry.node.name === 'Camera').map((mesh) => mesh.metadata.extra);
scene.render();
assert.deepEqual(frames.map((data) => Math.round(data.matrix[12]) + 0).sort(), [0, 5], 'the camera and its instance draw their frames');
assert.equal(frames.find((data) => data.entry.instance).entry.instance.instancer.name, 'Instancer');
const [own, instance] = frames.map((data) => Array.from(data.matrix.slice(0, 12), (v) => v.toFixed(4)));
assert.deepEqual(instance, own, 'turned as the camera is');
console.log("Collection instances: an instanced object's Geometry Nodes instances draw, as Blender's dupli list nests them; an instanced camera draws its overlay at its instance");
