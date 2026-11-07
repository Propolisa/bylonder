// A curve object the viewport draws (its wire mesh, main-api.cc object_mesh_eval) keeps its evaluated geometry as
// Blender has it: Geometry Nodes reading it by Object Info see its curves only, not the drawn wire as a mesh as well.
import assert from 'node:assert/strict';
import { NullEngine, Scene } from '@babylonjs/core';
import { createCollections } from '../src/blenkernel/scene/collections.js';
import { createSelection } from '../src/editors/object/selection.js';
import { buildMesh } from '../src/editors/object/mesh-catalog.js';
import { OPERATOR_FINISHED } from '../src/bmesh/bmesh-wasm.js';
import { idStruct, inPythonContext, setContextPointer } from '../src/python/bpy_rna.js';
import { sceneMain } from './scene-main.js';

const scene = new Scene(new NullEngine()), objects = [];
objects.scene = scene;
const world = { scene, objects };
world.collections = createCollections(world);
const cube = buildMesh(scene, 'Cube', { operator: 'mesh.primitive_cube_add', options: {} });
cube.metadata = { wbId: 'cube', wbCreation: { operator: 'mesh.primitive_cube_add', options: {} } };
objects.push(cube);
const selection = createSelection(scene, objects);
const sync = sceneMain(world, selection), { blender } = sync;
setContextPointer(blender.C);
const run = (idname, props = {}) => assert.equal(sync.run(() => blender.run(idname, props)).status, OPERATOR_FINISHED, idname);

// A Bezier circle (4 control points), drawn as the viewport draws it.
run('curve.primitive_bezier_circle_add');
const circle = objects.at(-1);
assert.ok(blender.evaluatedMesh(sync.objectOf(circle)), 'the circle draws as its wire');

// The cube's Geometry Nodes put an instance on each point Object Info gives of the circle.
selection.replace([cube]);
run('object.modifier_add', { type: 'NODES' });
run('node.new_geometry_node_group_assign');
const { nodes, links } = idStruct(sync.objectOf(cube)).modifiers.active.node_group;
const info = nodes.new('GeometryNodeObjectInfo'), points = nodes.new('GeometryNodeInstanceOnPoints'), cone = nodes.new('GeometryNodeMeshCone');
inPythonContext(blender.C, () => { info.inputs.get('Object').default_value = idStruct(sync.objectOf(circle)); });
links.new(info.outputs.get('Geometry'), points.inputs.get('Points'));
links.new(cone.outputs.get('Mesh'), points.inputs.get('Instance'));
links.new(points.outputs[0], nodes.get('Group Output').inputs[0]);
sync.redraw();

const count = blender.instances().reduce((sum, group) => sum + group.data.length / 16, 0);
assert.equal(count, 4, "an instance on each of the circle's 4 control points, as in Blender");
console.log("Curve objects: Object Info reads a drawn curve's curves, not its viewport wire");
