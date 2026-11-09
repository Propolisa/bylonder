// Node trees as the IR's graphs (src/io_scene_babylon/ir-graphs.js) on the Geometry Nodes example: its modifier's
// tree and a material's, a group the tree uses and a repeat zone, all as plain data that needs no Blender to read.
import assert from 'node:assert/strict';
import { openExample } from './open-example.js';
import { blendData } from '../src/python/bpy_rna.js';
import { writeGraph } from '../src/io_scene_babylon/ir-graphs.js';

openExample('geometry-nodes');
const data = blendData(), planet = data.node_groups.get('Planet');
const graphs = writeGraph(planet, 'NT:Planet');
writeGraph(data.materials.get('Terrain').node_tree, 'MA:Terrain/node_tree', graphs);
const graph = graphs['NT:Planet'], node = (name, g = graph) => g.nodes.find((n) => n.name === name);
assert.ok(JSON.parse(JSON.stringify(graphs)), 'graphs are plain JSON');

assert.equal(graph.type, 'GEOMETRY');
assert.deepEqual(graph.interface.filter((s) => s.in_out === 'INPUT').map((s) => [s.identifier, s.name]),
  [['Socket_0', 'Geometry'], ['Socket_2', 'Seed'], ['Socket_3', 'Mountains'], ['Socket_4', 'Sea Level'], ['Socket_5', 'Forest Density'], ['Socket_6', 'Cloud Cover']]);
assert.equal(graph.interface.find((s) => s.name === 'Seed').default, 2);
assert.ok(!graph.nodes.some((n) => n.type === 'node:NodeFrame'), 'frames are layout, not written');
assert.equal(graph.links.length, [...planet.links].length, 'every link between two nodes');
assert.deepEqual(node('Math').settings, { operation: 'SUBTRACT', use_clamp: false });
assert.deepEqual(node('Math.001').inputs, { Value_001: Math.fround(-0.03) }, 'unlinked inputs by identifier, linked ones left out');
assert.deepEqual(node('Math').sockets, { inputs: { Value: 'VALUE', Value_001: 'VALUE' }, outputs: { Value: 'VALUE' } }, 'only enabled sockets');
assert.deepEqual(node('Collection Info').inputs.Collection, { id: 'GR:Trees' }, 'an ID by its key');
assert.deepEqual(node('Set Material').inputs.Material, { id: 'MA:Terrain' });
assert.deepEqual(graph.links.filter((l) => l[2] === 'Join Geometry').map((l) => l[0]),
  ['Set Material.002', 'Set Material.001', 'Store Named Attribute.001', 'Set Material'].filter((name) => graph.links.some((l) => l[0] === name && l[2] === 'Join Geometry'))
    .sort((a, b) => graph.links.findIndex((l) => l[0] === a && l[2] === 'Join Geometry') - graph.links.findIndex((l) => l[0] === b && l[2] === 'Join Geometry')),
  'a multi-input socket\'s links in one run');

const terrain = graphs['MA:Terrain/node_tree'];
assert.equal(terrain.type, 'SHADER');
assert.deepEqual(node('Color Ramp', terrain).settings.color_ramp.elements.map((e) => +e.position.toFixed(2)), [0, 0.06, 0.3, 0.62, 0.8]);
assert.equal(node('Attribute', terrain).settings.attribute_name, 'height');

// An image node's image by its key, a curve's points as settings.
const lava = data.materials.new('Lava');
const image = lava.node_tree.nodes.new('ShaderNodeTexImage'), curve = lava.node_tree.nodes.new('ShaderNodeFloatCurve');
image.image = data.images.new('Rock', 4, 4);
const shader = writeGraph(lava.node_tree, 'MA:Lava/node_tree')['MA:Lava/node_tree'];
assert.deepEqual(node('Image Texture', shader).settings.image, { id: 'IM:Rock' });
assert.deepEqual(node('Float Curve', shader).settings.mapping.curves[0].points.map((p) => p.location), [[0, 0], [1, 1]]);

// A group with a repeat zone, used by a group node in a new tree, through a reroute and past a muted node.
const inner = data.node_groups.new('Inner', 'GeometryNodeTree');
inner.interface.new_socket('Geometry', { __kwargtrans__: true, in_out: 'INPUT', socket_type: 'NodeSocketGeometry' });
inner.interface.new_socket('Geometry', { __kwargtrans__: true, in_out: 'OUTPUT', socket_type: 'NodeSocketGeometry' });
const [start, end] = [inner.nodes.new('GeometryNodeRepeatInput'), inner.nodes.new('GeometryNodeRepeatOutput')];
start.pair_with_output(end);
const groupIn = inner.nodes.new('NodeGroupInput'), groupOut = inner.nodes.new('NodeGroupOutput');
inner.links.new(groupIn.outputs[0], start.inputs.get('Geometry'));
inner.links.new(start.outputs.get('Geometry'), end.inputs.get('Geometry'));
inner.links.new(end.outputs.get('Geometry'), groupOut.inputs[0]);
const outer = data.node_groups.new('Outer', 'GeometryNodeTree');
const call = outer.nodes.new('GeometryNodeGroup'), reroute = outer.nodes.new('NodeReroute'), muted = outer.nodes.new('GeometryNodeTransform');
const join = outer.nodes.new('GeometryNodeJoinGeometry'), mutedMath = outer.nodes.new('ShaderNodeMath'), math = outer.nodes.new('ShaderNodeMath');
call.node_tree = inner;
muted.mute = mutedMath.mute = true;
mutedMath.inputs[0].default_value = 4;
outer.links.new(call.outputs[0], reroute.inputs[0]);
outer.links.new(reroute.outputs[0], muted.inputs[0]);
outer.links.new(muted.outputs[0], join.inputs[0]);
outer.links.new(mutedMath.outputs[0], math.inputs[1]);
const nested = writeGraph(outer, 'NT:Outer');
assert.deepEqual(Object.keys(nested), ['NT:Outer', 'NT:Inner'], 'a group is its own graph');
assert.deepEqual(node('Group', nested['NT:Outer']).settings.node_tree, { graph: 'NT:Inner' });
assert.deepEqual(nested['NT:Outer'].links, [['Group', 'Socket_1', 'Join Geometry', 'Geometry']], 'a link through a reroute and a muted node joins its ends');
assert.deepEqual(nested['NT:Outer'].nodes.map((n) => n.name), ['Group', 'Join Geometry', 'Math.001'], 'neither is written');
assert.equal(node('Math.001', nested['NT:Outer']).inputs.Value_001, 4, 'a muted node passes on the value of the input its internal link starts at');
const zone = nested['NT:Inner'];
assert.deepEqual(node('Repeat Input', zone).settings.paired_output, { node: 'Repeat Output' }, 'a zone by its paired nodes');
assert.deepEqual(node('Repeat Output', zone).settings.repeat_items.map((item) => [item.name, item.socket_type]), [['Geometry', 'GEOMETRY']]);
console.log('IR graphs: Geometry Nodes and shader trees with settings, values, links, interface, groups and zones');
