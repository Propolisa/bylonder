// Bylonder's Geometry Nodes evaluator (src/io_scene_babylon/runtime/geometry-nodes/) on hand-written IR graphs, each
// node through the registry, with pure-JS stand-in units: single values, fields read on a mesh's domains, instances,
// a group, a repeat zone, a lazy switch, and a unit registered for node:ShaderNodeMath taking over.
import assert from 'node:assert/strict';
import { createEvaluator } from '../src/io_scene_babylon/runtime/geometry-nodes/evaluator.js';
import { register, unregister } from '../src/io_scene_babylon/runtime/units.js';
import { STAND_INS, compose } from './geometry-nodes/stand-ins.js';

for (const [type, unit] of Object.entries(STAND_INS)) register(type, unit);

// Socket types of the nodes the graphs use, as the writer records them (src/io_scene_babylon/ir-graphs.js).
const G = 'GEOMETRY', V = 'VALUE', VEC = 'VECTOR';
const SOCKETS = {
  NodeGroupInput: [{}, { Geometry: G, Socket_2: V, Socket_3: V }],
  NodeGroupOutput: [{ Geometry: G, Socket_9: V }, {}],
  ShaderNodeMath: [{ Value: V, Value_001: V }, { Value: V }],
  ShaderNodeCombineXYZ: [{ X: V, Y: V, Z: V }, { Vector: VEC }],
  GeometryNodeInputIndex: [{}, { Index: 'INT' }],
  GeometryNodeSetPosition: [{ Geometry: G, Selection: 'BOOLEAN', Position: VEC, Offset: VEC }, { Geometry: G }],
  GeometryNodeJoinGeometry: [{ Geometry: G }, { Geometry: G }],
  GeometryNodeTransform: [{ Geometry: G, Translation: VEC, Rotation: 'ROTATION', Scale: VEC }, { Geometry: G }],
  GeometryNodeSwitch: [{ Switch: 'BOOLEAN', False: G, True: G }, { Output: G }],
  GeometryNodeRepeatInput: [{ Iterations: 'INT', Geometry: G }, { Iteration: 'INT', Geometry: G }],
  GeometryNodeRepeatOutput: [{ Geometry: G }, { Geometry: G }],
  GeometryNodeGroup: [{ Socket_0: V }, { Socket_1: V }],
};
const DEFAULT_INPUTS = {
  GeometryNodeSetPosition: { Selection: true, Position: [0, 0, 0], Offset: [0, 0, 0] },
  GeometryNodeTransform: { Translation: [0, 0, 0], Rotation: [0, 0, 0], Scale: [1, 1, 1] },
  ShaderNodeMath: { Value: 0.5, Value_001: 0.5 },
  ShaderNodeCombineXYZ: { X: 0, Y: 0, Z: 0 },
};
const node = (name, idname, { settings = {}, inputs = {}, sockets } = {}) => {
  const [ins, outs] = sockets ?? SOCKETS[idname];
  return { name, type: `node:${idname}`, settings, inputs: { ...DEFAULT_INPUTS[idname], ...inputs }, sockets: { inputs: ins, outputs: outs },
    ...(idname === 'GeometryNodeJoinGeometry' && { multi_input: ['Geometry'] }) };
};
const graph = (nodes, links, iface = []) => ({ type: 'GEOMETRY', nodes, links, interface: iface });

// A quad and a triangle sharing nothing: 7 points, 2 faces.
const mesh = {
  vert_positions: new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 2, 0, 0, 3, 0, 0, 2, 1, 0]),
  edges: [0, 1, 1, 2, 2, 3, 3, 0, 4, 5, 5, 6, 6, 4], face_offsets: [0, 4, 7], corner_verts: [0, 1, 2, 3, 4, 5, 6], corner_edges: [0, 1, 2, 3, 4, 5, 6],
};
const xs = (geometry) => Array.from(geometry.mesh.vert_positions).filter((_, i) => i % 3 === 0);
const zs = (geometry) => Array.from(geometry.mesh.vert_positions).filter((_, i) => i % 3 === 2);

// Fields: each point lifted by its index times Seed (a single value through Math), so Z = index * seed.
const lift = graph([
  node('Group Input', 'NodeGroupInput'), node('Group Output', 'NodeGroupOutput'),
  node('Index', 'GeometryNodeInputIndex'), node('Times', 'ShaderNodeMath', { settings: { operation: 'MULTIPLY' } }),
  node('Seed Twice', 'ShaderNodeMath', { settings: { operation: 'MULTIPLY' }, inputs: { Value_001: 2 } }),
  node('Up', 'ShaderNodeCombineXYZ'), node('Set Position', 'GeometryNodeSetPosition'),
], [
  ['Index', 'Index', 'Times', 'Value'], ['Group Input', 'Socket_2', 'Times', 'Value_001'], ['Times', 'Value', 'Up', 'Z'],
  ['Up', 'Vector', 'Set Position', 'Offset'], ['Group Input', 'Geometry', 'Set Position', 'Geometry'],
  ['Set Position', 'Geometry', 'Group Output', 'Geometry'], ['Group Input', 'Socket_2', 'Seed Twice', 'Value'], ['Seed Twice', 'Value', 'Group Output', 'Socket_9'],
], [{ identifier: 'Socket_2', name: 'Seed', in_out: 'INPUT', socket_type: 'NodeSocketFloat', default: 1 }]);
const evaluator = createEvaluator({ 'NT:Lift': lift });
for (const seed of [0.5, 3]) {
  const out = await evaluator.evaluate('NT:Lift', { Geometry: { mesh }, Socket_2: seed });
  assert.deepEqual(zs(out.Geometry), [0, 1, 2, 3, 4, 5, 6].map((i) => Math.fround(i * seed)), `a field read on the points at seed ${seed}`);
  assert.equal(out.Socket_9, seed * 2, 'single values compute once');
}
assert.equal((await evaluator.evaluate('NT:Lift', { Geometry: { mesh } })).Socket_9, 2, 'an input not given takes its interface default');
assert.deepEqual(Array.from(mesh.vert_positions.slice(0, 3)), [0, 0, 0], 'the input geometry is left as it was');

// A stand-in for node:ShaderNodeMath takes over every Math node: here it adds one to what it computes.
const math = STAND_INS['node:ShaderNodeMath'];
register('node:ShaderNodeMath', { run: (inputs, context) => ({ Value: math.run(inputs, context).Value.map((v) => v + 1) }) });
const taken = await evaluator.evaluate('NT:Lift', { Geometry: { mesh }, Socket_2: 2 });
assert.deepEqual(zs(taken.Geometry), [0, 1, 2, 3, 4, 5, 6].map((i) => i * 2 + 1));
assert.equal(taken.Socket_9, 5, 'the registered unit runs in place of the shipped one');
register('node:ShaderNodeMath', math);

// Instances and Join: a mesh joined with instances, both moved by Transform Geometry.
const instances = { references: [{ id: 'OB:Pine' }], reference_indices: [0, 0], transforms: new Float32Array([...compose([1, 0, 0], [0, 0, 0], [1, 1, 1]), ...compose([0, 2, 0], [0, 0, 0], [1, 1, 1])]) };
const joined = graph([
  node('Group Input', 'NodeGroupInput'), node('Group Output', 'NodeGroupOutput'), node('Join', 'GeometryNodeJoinGeometry'),
  node('Move', 'GeometryNodeTransform', { inputs: { Translation: [0, 0, 5] } }),
  node('Trees', 'NodeGroupInput', { sockets: [{}, { Socket_3: G }] }),
], [['Group Input', 'Geometry', 'Join', 'Geometry'], ['Trees', 'Socket_3', 'Join', 'Geometry'], ['Join', 'Geometry', 'Move', 'Geometry'], ['Move', 'Geometry', 'Group Output', 'Geometry']]);
const both = (await createEvaluator({ 'NT:Join': joined }).evaluate('NT:Join', { Geometry: { mesh }, Socket_3: { instances } })).Geometry;
assert.deepEqual(zs(both), Array(7).fill(5), 'the mesh moved');
assert.deepEqual([12, 13, 14, 28, 29, 30].map((i) => both.instances.transforms[i]), [1, 0, 5, 0, 2, 5], 'its instances moved with it');
assert.deepEqual(both.instances.references, [{ id: 'OB:Pine' }]);

// A group: a field built inside a group (Index plus the group's input) read by a node outside it.
const inner = graph([
  node('Group Input', 'NodeGroupInput', { sockets: [{}, { Socket_0: V }] }), node('Group Output', 'NodeGroupOutput', { sockets: [{ Socket_1: V }, {}] }),
  node('Index', 'GeometryNodeInputIndex'), node('Add', 'ShaderNodeMath', { settings: { operation: 'ADD' } }),
], [['Index', 'Index', 'Add', 'Value'], ['Group Input', 'Socket_0', 'Add', 'Value_001'], ['Add', 'Value', 'Group Output', 'Socket_1']]);
const outer = graph([
  node('Group Input', 'NodeGroupInput'), node('Group Output', 'NodeGroupOutput'),
  node('Group', 'GeometryNodeGroup', { settings: { node_tree: { graph: 'NT:Inner' } }, inputs: { Socket_0: 10 } }),
  node('Right', 'ShaderNodeCombineXYZ'), node('Set Position', 'GeometryNodeSetPosition'),
], [['Group', 'Socket_1', 'Right', 'X'], ['Right', 'Vector', 'Set Position', 'Offset'], ['Group Input', 'Geometry', 'Set Position', 'Geometry'], ['Set Position', 'Geometry', 'Group Output', 'Geometry']]);
const grouped = (await createEvaluator({ 'NT:Outer': outer, 'NT:Inner': inner }).evaluate('NT:Outer', { Geometry: { mesh } })).Geometry;
assert.deepEqual(xs(grouped), [10, 12, 13, 13, 16, 18, 18], 'a group\'s field is read where it is used');

// A repeat zone: three iterations, each moving the mesh by its iteration's index plus one along X.
const repeat = graph([
  node('Group Input', 'NodeGroupInput'), node('Group Output', 'NodeGroupOutput'),
  node('Repeat Input', 'GeometryNodeRepeatInput', { settings: { paired_output: { node: 'Repeat Output' } }, inputs: { Iterations: 3 } }),
  node('Repeat Output', 'GeometryNodeRepeatOutput'), node('Step', 'ShaderNodeMath', { settings: { operation: 'ADD' }, inputs: { Value_001: 1 } }),
  node('Right', 'ShaderNodeCombineXYZ'), node('Move', 'GeometryNodeTransform'),
], [
  ['Group Input', 'Geometry', 'Repeat Input', 'Geometry'], ['Repeat Input', 'Iteration', 'Step', 'Value'], ['Step', 'Value', 'Right', 'X'],
  ['Right', 'Vector', 'Move', 'Translation'], ['Repeat Input', 'Geometry', 'Move', 'Geometry'], ['Move', 'Geometry', 'Repeat Output', 'Geometry'],
  ['Repeat Output', 'Geometry', 'Group Output', 'Geometry'],
]);
const repeated = (await createEvaluator({ 'NT:Repeat': repeat }).evaluate('NT:Repeat', { Geometry: { mesh } })).Geometry;
assert.deepEqual(xs(repeated), xs({ mesh }).map((x) => x + 6), 'each iteration reads its own index');

// A switch evaluates only the branch it picks: the other has a node nothing implements.
const lazy = graph([
  node('Group Input', 'NodeGroupInput'), node('Group Output', 'NodeGroupOutput'),
  node('Switch', 'GeometryNodeSwitch', { inputs: { Switch: false } }), node('Missing', 'GeometryNodeUnknown', { sockets: [{}, { Geometry: G }] }),
], [['Group Input', 'Geometry', 'Switch', 'False'], ['Missing', 'Geometry', 'Switch', 'True'], ['Switch', 'Output', 'Group Output', 'Geometry']]);
assert.equal((await createEvaluator({ 'NT:Lazy': lazy }).evaluate('NT:Lazy', { Geometry: { mesh } })).Geometry.mesh, mesh);
await assert.rejects(createEvaluator({ 'NT:Lazy': lazy }).evaluate('NT:Lazy', { Geometry: { mesh }, Socket_2: 0 }).then(() => {
  lazy.nodes[2].inputs.Switch = true;
  return createEvaluator({ 'NT:Lazy': lazy }).evaluate('NT:Lazy', { Geometry: { mesh } });
}), /nothing implements node:GeometryNodeUnknown/, 'a node without a unit says so');

// Kernel fragments are atomic: a kernel geometry node gets itself and the field nodes feeding it, never another
// geometry node. Here Set Position runs as a kernel would, its Offset a field of Math and Combine XYZ run as kernels,
// its geometry from a Transform before it.
const fragments = [];
const kernel = { kernel: true, async run(inputs, context) {
  if (!context.fragment) return STAND_INS[context.node.type].run(inputs, context);
  const fragment = await context.fragment();
  fragments.push(fragment);
  return STAND_INS[context.node.type].run(inputs, context);
} };
const chain = graph([
  node('Group Input', 'NodeGroupInput'), node('Group Output', 'NodeGroupOutput'), node('Move', 'GeometryNodeTransform', { inputs: { Translation: [0, 0, 1] } }),
  node('Index', 'GeometryNodeInputIndex'), node('Times', 'ShaderNodeMath', { settings: { operation: 'MULTIPLY' } }), node('Up', 'ShaderNodeCombineXYZ'),
  node('Set Position', 'GeometryNodeSetPosition'),
], [
  ['Group Input', 'Geometry', 'Move', 'Geometry'], ['Move', 'Geometry', 'Set Position', 'Geometry'], ['Index', 'Index', 'Times', 'Value'],
  ['Group Input', 'Socket_2', 'Times', 'Value_001'], ['Times', 'Value', 'Up', 'Z'], ['Up', 'Vector', 'Set Position', 'Offset'], ['Set Position', 'Geometry', 'Group Output', 'Geometry'],
]);
const kernels = new Set(['node:GeometryNodeSetPosition', 'node:GeometryNodeTransform', 'node:ShaderNodeMath', 'node:ShaderNodeCombineXYZ']);
const atomic = createEvaluator({ 'NT:Chain': chain }, { unit: (type) => (kernels.has(type) ? kernel : STAND_INS[type]) });
assert.deepEqual(zs((await atomic.evaluate('NT:Chain', { Geometry: { mesh }, Socket_2: 2 })).Geometry), [0, 1, 2, 3, 4, 5, 6].map((i) => 1 + i * 2));
const geometryNodes = (f) => f.graph.nodes.filter((n) => Object.values(n.sockets?.inputs ?? {}).concat(Object.values(n.sockets?.outputs ?? {})).includes('GEOMETRY'));
assert.deepEqual(fragments.map((f) => geometryNodes(f).map((n) => n.name)), [['Move'], ['Set Position']], 'one geometry node per kernel call');
const [, setPosition] = fragments;
assert.deepEqual(setPosition.graph.nodes.map((n) => n.name).sort(), ['Set Position', 'Times', 'Up', 'bylonder:named .bylonder_in_0'], 'with the field nodes feeding it, Index read from its attribute');
assert.deepEqual(setPosition.graph.inputs, ['GEOMETRY', 'VALUE'], 'its geometry and the single value a field reads are its inputs');
assert.equal(setPosition.external.length, 1, 'a field input implemented in JS is read from an attribute the caller stores');

for (const type of Object.keys(STAND_INS)) unregister(type);
console.log('Geometry Nodes evaluator: fields, instances, groups, repeat zones and lazy switches through the registry; a Math stand-in takes over');
