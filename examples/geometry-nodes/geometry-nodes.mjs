// Builds geometry-nodes.blend with Blender's own code in Bylonder's module: a meadow whose Geometry Nodes modifier
// scatters trees (a node group) on a grid, sized by a named attribute, as docs/features/geometry-nodes.md builds it.
// usage: node examples/geometry-nodes/geometry-nodes.mjs
import { writeFileSync } from 'node:fs';
import { BlenderMain, OPERATOR_FINISHED, datafiles } from '../../src/bmesh/bmesh-wasm.js';
import { blendData, contextStruct, inPythonContext, setContextPointer } from '../../src/python/bpy_rna.js';
import { __kwargtrans__ } from '../../src/bl_py/org.transcrypt.__runtime__.js';
import '../../src/python/bpy_interface.js';

await datafiles;
const main = new BlenderMain();
setContextPointer(main.C);
const run = (idname, props) => {
  const { status, report } = main.run(idname, props);
  if (!(status & OPERATOR_FINISHED)) throw Error(`${idname}: ${report}`);
};
const kw = (args) => __kwargtrans__(args);

inPythonContext(main.C, () => {
  const data = blendData(), material = (name, color) => {
    const ma = data.materials.new(name);
    ma.diffuse_color = color;
    return ma;
  };
  run('mesh.primitive_grid_add', { x_subdivisions: 12, y_subdivisions: 12, size: 10 });
  const ground = contextStruct().active_object;
  ground.name = 'Meadow';
  ground.data.materials.append(material('Grass', [0.25, 0.45, 0.15, 1]));

  // The tree: a node group of a cone standing on its base.
  const tree = data.node_groups.new('Tree', 'GeometryNodeTree');
  tree.interface.new_socket(kw({ name: 'Geometry', in_out: 'OUTPUT', socket_type: 'NodeSocketGeometry' }));
  const cone = tree.nodes.new('GeometryNodeMeshCone'), lift = tree.nodes.new('GeometryNodeTransform');
  const leaves = tree.nodes.new('GeometryNodeSetMaterial'), treeOutput = tree.nodes.new('NodeGroupOutput');
  cone.inputs.get('Vertices').default_value = 8;
  cone.inputs.get('Radius Bottom').default_value = 0.5;
  lift.inputs.get('Translation').default_value = [0, 0, 1];
  leaves.inputs.get('Material').default_value = material('Leaves', [0.1, 0.35, 0.12, 1]);
  tree.links.new(cone.outputs.get('Mesh'), lift.inputs.get('Geometry'));
  tree.links.new(lift.outputs[0], leaves.inputs.get('Geometry'));
  tree.links.new(leaves.outputs[0], treeOutput.inputs[0]);
  [[cone, -400], [lift, -200], [leaves, 0], [treeOutput, 200]].forEach(([node, x]) => { node.location = [x, 0]; });

  // Scatter: points on the meadow, each with a random height stored as a named attribute, and a tree on each point
  // scaled by it; the points stay as a point cloud.
  run('object.modifier_add', { type: 'NODES' });
  run('node.new_geometry_node_group_assign');
  const modifier = ground.modifiers.active, scatter = modifier.node_group;
  scatter.name = 'Scatter';
  modifier.name = 'Scatter';
  // A group input with its default, which the modifier's input takes too (its value is kept from when it was made).
  const socket = (name, type, value) => {
    const item = scatter.interface.new_socket(kw({ name, in_out: 'INPUT', socket_type: type }));
    item.default_value = value;
    modifier.properties.inputs[item.identifier].value = value;
  };
  socket('Density', 'NodeSocketFloat', 0.4);
  socket('Scale', 'NodeSocketFloat', 0.8);
  socket('Seed', 'NodeSocketInt', 0);
  const n = scatter.nodes, l = scatter.links, input = n.get('Group Input'), output = n.get('Group Output');
  const distribute = n.new('GeometryNodeDistributePointsOnFaces'), random = n.new('FunctionNodeRandomValue');
  const store = n.new('GeometryNodeStoreNamedAttribute'), named = n.new('GeometryNodeInputNamedAttribute');
  const multiply = n.new('ShaderNodeMath'), group = n.new('GeometryNodeGroup'), instance = n.new('GeometryNodeInstanceOnPoints');
  const join = n.new('GeometryNodeJoinGeometry');
  group.node_tree = tree;
  random.inputs.get('Min').default_value = 0.6;
  random.inputs.get('Max').default_value = 1.6;
  store.inputs.get('Name').default_value = 'height';
  named.inputs.get('Name').default_value = 'height';
  multiply.operation = 'MULTIPLY';
  l.new(input.outputs.get('Geometry'), distribute.inputs.get('Mesh'));
  l.new(input.outputs.get('Density'), distribute.inputs.get('Density'));
  l.new(input.outputs.get('Seed'), distribute.inputs.get('Seed'));
  l.new(input.outputs.get('Seed'), random.inputs.get('Seed'));
  l.new(distribute.outputs.get('Points'), store.inputs.get('Geometry'));
  l.new(random.outputs.get('Value'), store.inputs.get('Value'));
  l.new(named.outputs.get('Attribute'), multiply.inputs[0]);
  l.new(input.outputs.get('Scale'), multiply.inputs[1]);
  l.new(store.outputs[0], instance.inputs.get('Points'));
  l.new(group.outputs[0], instance.inputs.get('Instance'));
  l.new(multiply.outputs[0], instance.inputs.get('Scale'));
  l.new(input.outputs.get('Geometry'), join.inputs[0]);
  l.new(instance.outputs[0], join.inputs[0]);
  l.new(store.outputs[0], join.inputs[0]);
  l.new(join.outputs[0], output.inputs[0]);
  [[input, -900, 0], [distribute, -650, 100], [random, -650, -200], [store, -400, 100], [named, -400, -200], [group, -400, 300],
    [multiply, -200, -150], [instance, 0, 150], [join, 250, 50], [output, 450, 50]].forEach(([node, x, y]) => { node.location = [x, y]; });

  run('object.camera_add', { location: [14, -14, 10], rotation: [1.0, 0, 0.785] });
  data.scenes[0].camera = contextStruct().active_object;
  run('object.light_add', { type: 'SUN', location: [0, 0, 10], rotation: [0.6, 0.2, 0.4] });
  run('object.select_all', { action: 'DESELECT' });
  ground.select_set(true);
  contextStruct().view_layer.objects.active = ground;
});
writeFileSync(new URL('./geometry-nodes.blend', import.meta.url), main.writeBlend());
