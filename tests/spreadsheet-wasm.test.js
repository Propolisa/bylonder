// Geometry Nodes from an empty node group, drawn and inspected as in Blender: Add Modifier > Geometry Nodes and New
// (Blender's operators), a tree built through Blender's API, its instances and point cloud drawn as thin instances
// (main-api.cc main_instances, main-view.js drawInstances), and Blender's Spreadsheet (SPACE_SPREADSHEET) showing the
// evaluated and original geometry, its data set and its row count.
import assert from 'node:assert/strict';
import { NullEngine, Scene, MeshBuilder } from '@babylonjs/core';
import { OPERATOR_FINISHED } from '../src/bmesh/bmesh-wasm.js';
import { createModifierSystem } from '../src/modifiers/stack.js';
import { createAnimationModel } from '../src/blenkernel/animation/model.js';
import { contextStruct, idStruct, inPythonContext, pointerStruct, setContextPointer, structFind } from '../src/python/bpy_rna.js';
import { Window, loadKeyconfig, RGN_TYPE_WINDOW, RGN_TYPE_HEADER, RGN_TYPE_TOOLS, RGN_TYPE_FOOTER } from '../src/windowmanager/wm-window.js';
import { regionPanels } from '../src/editors/interface/ui-tree.js';
import { createMainNodeTree } from '../src/editors/space_node/main-node-tree.js';
import { createSelection } from '../src/editors/object/selection.js';
import { sceneMain } from './scene-main.js';
import { ID_MA } from '../src/blenkernel/main-view.js';

const engine = new NullEngine(), scene = new Scene(engine), box = MeshBuilder.CreateBox('Cube', { size: 2 }, scene);
box.metadata = { wbId: 'cube', wbCreation: { operator: 'mesh.primitive_cube_add', options: {} } };
const world = { scene, objects: Object.assign([box], { scene }), animation: createAnimationModel() };
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

// Add Modifier > Geometry Nodes, then the modifier panel's New: Blender's default group passes the cube through.
run('object.modifier_add', { type: 'NODES' });
run('node.new_geometry_node_group_assign');
const ob = sync.objectOf(box), modifier = idStruct(ob).modifiers.active, group = modifier.node_group;
assert.equal(modifier.type, 'NODES');
assert.deepEqual([...group.nodes].map((n) => n.bl_idname).sort(), ['NodeGroupInput', 'NodeGroupOutput']);

// Mesh to Points and Instance on Points (an Ico Sphere on each of the cube's corners), joined with the points.
const nodes = group.nodes, links = group.links, input = nodes.get('Group Input'), output = nodes.get('Group Output');
const points = nodes.new('GeometryNodeMeshToPoints'), sphere = nodes.new('GeometryNodeMeshIcoSphere');
const instance = nodes.new('GeometryNodeInstanceOnPoints'), join = nodes.new('GeometryNodeJoinGeometry');
links.new(input.outputs[0], points.inputs.get('Mesh'));
links.new(points.outputs[0], instance.inputs.get('Points'));
links.new(sphere.outputs.get('Mesh'), instance.inputs.get('Instance'));
links.new(instance.outputs[0], join.inputs[0]);
links.new(points.outputs[0], join.inputs[0]);
links.new(join.outputs[0], output.inputs[0]);
points.inputs.get('Radius').default_value = 0.25;
sync.redraw();

// Drawn: the spheres as thin instances of one mesh, each point a sphere of its radius drawn instanced from its position
// and radius alone, and no mesh of the cube's.
const spheres = blender.instances().find((g) => g.shape === 'MESH'), [cloud] = blender.pointClouds();
assert.equal(spheres?.data.length, 8 * 16, 'an instance per corner');
assert.equal(cloud?.points.length, 8 * 4, 'a point per corner');
assert.equal(cloud.points[3], 0.25, "a point's radius");
assert.equal(blender.instanceMesh(spheres.geometry).faces_num, 20, 'the instanced Ico Sphere');
assert.deepEqual(scene.meshes.filter((m) => m.name.startsWith('__instances')).map((m) => m.thinInstanceCount), [8], 'one carrier, thin instanced');
const pointMesh = scene.meshes.find((m) => m.name.startsWith('__pointcloud '));
assert.equal(pointMesh?.forcedInstanceCount, 8, 'a quad per point');
assert(pointMesh.material.pluginManager.getPlugin('BlenderPointCloud'), "the point cloud's material draws spheres");
assert.equal(box.getTotalVertices(), 0, 'the evaluated geometry has no mesh');
{
  // Set Material on the instanced Ico Sphere: Blender gives its mesh an empty slot, then the material; the instances
  // draw in Main's material.
  const red = python((C) => C.blend_data.materials.new('Red')), setMaterial = nodes.new('GeometryNodeSetMaterial');
  links.new(sphere.outputs.get('Mesh'), setMaterial.inputs.get('Geometry'));
  links.new(setMaterial.outputs[0], instance.inputs.get('Instance'));
  setMaterial.inputs.get('Material').default_value = red;
  sync.redraw();
  const { material } = blender.instances().find((g) => g.shape === 'MESH');
  assert.equal(material && blender.name(material), 'Red', "the instances' material");
  assert.equal(material, blender.ids(ID_MA).find((ma) => blender.name(ma) === 'Red'), "Main's, not its evaluated copy");
  links.new(sphere.outputs.get('Mesh'), instance.inputs.get('Instance'));
  nodes.remove(setMaterial);
  sync.redraw();
}

// A link from the Group Input's empty socket to Radius makes Radius a group input, which the modifier shows as its
// input in Properties > Modifiers; its value there sizes the points.
const editorTree = createMainNodeTree(group, { changed: () => sync.redraw() }), editorNode = (type) => editorTree.nodes().find((n) => n.blender === type);
const extend = editorNode('NodeGroupInput').outputs.find((s) => s.id === '__extend__');
assert(editorTree.link(extend.point, editorNode('GeometryNodeMeshToPoints').inputs.find((s) => s.id === 'Radius').point));
const radius = [...group.interface.items_tree].find((item) => item.name === 'Radius');
assert.equal(radius?.in_out, 'INPUT', 'Radius is a group input');
assert.equal(modifier.properties.inputs[radius.identifier].value, 0.25, 'with the value its socket had');
modifier.properties.inputs[radius.identifier].value = 0.5;
idStruct(ob).update_tag();
sync.redraw();
blender.instances();
assert.equal(blender.pointClouds()[0].points[3], 0.5, "the modifier's input sizes the points");

// Blender's Spreadsheet: a SPACE_SPREADSHEET area of the window, its regions laid out as an editor's.
const window = new Window(blender);
window.size = { width: 1200, height: 800 };
loadKeyconfig(blender.C);
const area = window.area(23);
area.layout({ x: 0, y: 0, width: 900, height: 500 }, { [RGN_TYPE_HEADER]: { x: 0, y: 0, width: 900, height: 26 }, [RGN_TYPE_TOOLS]: { x: 0, y: 26, width: 160, height: 474 },
  [RGN_TYPE_WINDOW]: { x: 160, y: 26, width: 740, height: 450 }, [RGN_TYPE_FOOTER]: { x: 160, y: 476, width: 740, height: 24 } });
const texts = (node, out = []) => { if (node.text) out.push(node.text); node.children?.forEach((c) => texts(c, out)); node.parts?.forEach((p) => texts(p.layout, out)); return out; };
const dataSet = () => area.inContext(RGN_TYPE_TOOLS, (C) => regionPanels(C)).panels.flatMap((p) => texts(p));
const footer = () => texts({ children: area.draw(RGN_TYPE_FOOTER).draw.filter((op) => op.op === 'layout').flatMap((op) => op.layout) }).join(' ');
const spreadsheet = () => python(() => pointerStruct(structFind('Area'), 0, area.pointer).spaces.active);
dataSet();
area.draw(RGN_TYPE_WINDOW);
const shown = dataSet();
assert(shown.includes('Cube'), 'the active object is the context');
for (const component of ['Mesh', 'Point Cloud', 'Instances']) assert(shown.includes(component), `the data set lists ${component}`);

// The evaluated point cloud's points, and the cube's own vertices with the toggle on Original.
python(() => { const s = spreadsheet(); s.geometry_component_type = 'POINTCLOUD'; s.attribute_domain = 'POINT'; });
const cells = area.draw(RGN_TYPE_WINDOW);
assert.match(footer(), /Rows: 8 {3}\| {3}Columns: [234]/, 'eight points');
const text = cells.draw.filter((op) => op.op === 'text').map((op) => op.text);
assert(text.includes('position') && text.includes('radius'), 'columns named by their attributes');
assert(text.includes('0.500') && text.includes(' -1.000'), 'cells show their values');
python(() => { const s = spreadsheet(); s.object_eval_state = 'ORIGINAL'; s.geometry_component_type = 'MESH'; s.attribute_domain = 'POINT'; });
area.draw(RGN_TYPE_WINDOW);
assert.match(footer(), /Rows: 8 /, "the cube's eight vertices");
python(() => { spreadsheet().attribute_domain = 'FACE'; });
area.draw(RGN_TYPE_WINDOW);
assert.match(footer(), /Rows: 6 /, 'and its six faces');
console.log('Spreadsheet and Geometry Nodes: a modifier from New, its instances and point cloud as thin instances, an input from Group Input, the evaluated and original data by component and domain');
