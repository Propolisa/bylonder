// The Geometry Node Editor on Main's node groups (main-node-tree.js): the active Geometry Nodes modifier's group of the
// Hair Dynamics example is drawn as Blender's editor draws it, and edits made by the editor's operators are Blender's own
// API, which Blender's geometry nodes then evaluate.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { NullEngine, Scene } from '@babylonjs/core';
import { blenderMain, datafiles } from '../src/bmesh/bmesh-wasm.js';
import { contextStruct, idStruct, inPythonContext, setContextPointer } from '../src/python/bpy_rna.js';
import { createMainNodeTree } from '../src/editors/space_node/main-node-tree.js';
import { createNodeEditorController } from '../src/editors/space_node/node-editor-controller.js';
import { addMenuItems } from '../src/editors/space_node/node-add-menu.js';
import { keymapHandler } from '../src/windowmanager/keyconfig.js';
import { loadKeyconfig } from '../src/windowmanager/wm-window.js';
import { inArea } from '../src/windowmanager/wm-operators.js';
import { sceneMain } from './scene-main.js';

await datafiles;
loadKeyconfig(blenderMain().C);
const scene = new Scene(new NullEngine()), objects = Object.assign([], { scene });
const sync = sceneMain({ scene, objects });
const { nodes } = sync.readBlend(fs.readFileSync(new URL('../examples/hair-dynamics/hair-dynamics.blend', import.meta.url)), scene);
setContextPointer(sync.blender.C);
const python = (fn) => inPythonContext(sync.blender.C, fn);
const node = nodes.find((n) => n.name === 'Hair'), hair = idStruct(sync.objectOf(node));
hair.modifiers.get('Hair Dynamics').show_viewport = false;

// The editor shows the active modifier's node group (contexts.js geometry).
let commits = 0;
const group = hair.modifiers.active.node_group;
const tree = createMainNodeTree(group, { changed: () => commits++ });
const editor = createNodeEditorController(tree, { viewport: () => ({ width: 1200, height: 800 }) });
const byType = (type) => tree.nodes().filter((n) => n.blender === type);
const output = byType('NodeGroupOutput')[0];
assert.equal(tree.links().length, [...group.links].filter((l) => !l.is_hidden).length);
assert.deepEqual(tree.frames().map((f) => f.name), ['Base Curve', 'Remove by Density Texture', 'Surface Geometry', 'Stable IDs', 'Distribute Base Points']);
const math = byType('ShaderNodeMath').find((n) => n.inputs[0].value);
assert.equal(math.tag, 'CONVERTER', 'nodes are drawn in the color of their class');
assert.deepEqual(math.buttons, [], 'a node whose options are hidden draws no buttons');
const distribute = byType('GeometryNodeDistributePointsOnFaces')[0];
assert.deepEqual(distribute.buttons.map((b) => [b.key, b.label, b.get()]), [['distribute_method', '', 'RANDOM']], 'a node\'s buttons are what its draw_buttons lays out');
assert.deepEqual(output.buttons, [], 'Group Output draws no buttons');
assert.equal(output.y, -group.nodes.get(output.block.rna.name).location_absolute[1], 'the editor\'s y grows downward');

// Blender's Add menu for Geometry Nodes, every node enabled: Blender's code runs them all.
const menu = addMenuItems(editor).filter((i) => i !== '-').map((i) => i.label);
for (const category of ['Attribute', 'Input', 'Output', 'Geometry', 'Curve', 'Mesh', 'Point', 'Simulation', 'Utilities']) assert(menu.includes(category), `Add menu has ${category}`);

const points = () => python(() => {
  const curves = hair.evaluated_get(contextStruct().evaluated_depsgraph_get()).data;
  return [...curves.points].map((p) => [...p.position]);
});
const before = points();
assert(before.length > 1000, 'Blender evaluates the hair');

// A Transform Geometry node added between the curves and the Group Output, its Translation set, moves every point.
const geometryIn = output.inputs.find((s) => s.type === 'GEOMETRY'), from = geometryIn.point.connectedPoint;
const transform = tree.add('GeometryNodeTransform', output.x - 200, output.y, {});
const t = tree.node(transform);
assert(tree.link(from, t.inputs.find((s) => s.id === 'Geometry').point));
assert(tree.link(t.outputs[0].point, geometryIn.point), 'linking to a linked input replaces its link');
assert.equal(tree.node(tree.byId(output.id)).inputs[0].point.connectedPoint, t.outputs[0].point);
tree.node(transform).inputs.find((s) => s.id === 'Translation').value.set([0, 0, 1]);
const moved = points();
assert.equal(moved.length, before.length);
assert(moved.every((p, i) => Math.abs(p[2] - before[i][2] - 1) < 1e-5), 'every point moves up by the Translation');

// Duplicate is Blender's node.duplicate, the copy keeping the Translation; Join in New Frame is node.join; X on the
// frame and the copy is node.delete.
const [copy] = tree.duplicate([transform], 40, 40);
assert.equal(copy.rna.bl_idname, 'GeometryNodeTransform');
assert.deepEqual([...copy.rna.inputs.get('Translation').default_value], [0, 0, 1]);
assert.deepEqual(Object.values(tree.location(copy)).map(Math.round), Object.values(tree.location(transform)).map((v) => Math.round(v + 40)));
editor.state.selected = new Set([copy.uniqueId]);
assert(editor.run('node.join'));
const frame = tree.frames().find((f) => f.blocks.includes(copy.uniqueId));
assert(frame, 'the copy is in a new frame');
tree.operate('node.delete', [copy, frame]);
assert(!tree.blocks().some((b) => b.uniqueId === copy.uniqueId) && !tree.frames().some((f) => f.name === frame.name));

// M mutes the selected node by Blender's keymap: muted, it passes its geometry through.
const keys = keymapHandler(['Node Editor', 'Node Generic']);
editor.state.selected = new Set([transform.uniqueId]);
assert(inArea({ nodeEditor: editor }, () => keys({ type: 'M', value: 'PRESS' })));
assert.equal(transform.rna.mute, true, 'M runs node.mute_toggle');
assert(points().every((p, i) => Math.abs(p[2] - before[i][2]) < 1e-5), 'a muted node passes its input through');
// X deletes it, as Blender's keymap's node.delete; the curves no longer reach the output.
assert(inArea({ nodeEditor: editor }, () => keys({ type: 'X', value: 'PRESS' })));
assert(!tree.nodes().some((n) => n.blender === 'GeometryNodeTransform'));
assert.equal(points().length, 0, 'with the link gone, the modifier outputs no curves');
assert(commits > 0, 'each edit is an undo step');

// Ctrl G makes a node group of the selection, Tab enters the group node and Ctrl Tab leaves it, by Blender's
// operators in the editor's area: the editor shows the area's edit tree, and the group evaluates as the nodes did.
const lifted = tree.add('GeometryNodeTransform', output.x - 200, output.y, {});
assert(tree.link(from, tree.node(lifted).inputs.find((s) => s.id === 'Geometry').point));
assert(tree.link(tree.node(lifted).outputs[0].point, geometryIn.point));
tree.node(lifted).inputs.find((s) => s.id === 'Translation').value.set([0, 0, 1]);
const groupsBefore = new Set(byType('GeometryNodeGroup').map((n) => n.id));
editor.state.selected = new Set([lifted.uniqueId]);
assert(inArea({ nodeEditor: editor }, () => keys({ type: 'G', value: 'PRESS', ctrl: true })), 'Ctrl G runs node.group_make');
if (tree.graph.name !== group.name) assert(inArea({ nodeEditor: editor }, () => keys({ type: 'TAB', value: 'PRESS', ctrl: true })), 'Ctrl Tab leaves the group');
assert.equal(tree.graph.name, group.name);
const groupNode = byType('GeometryNodeGroup').find((n) => !groupsBefore.has(n.id));
assert(groupNode && !byType('GeometryNodeTransform').length, 'the Transform node is in a group node');
assert(points().every((p, i) => Math.abs(p[2] - before[i][2] - 1) < 1e-5), 'the group evaluates as its nodes did');
editor.state.selected = new Set([groupNode.id]);
assert(inArea({ nodeEditor: editor }, () => keys({ type: 'TAB', value: 'PRESS' })), 'Tab runs node.group_edit');
assert.equal(tree.graph.name, groupNode.block.rna.node_tree.name, 'the editor shows the group');
assert.equal(byType('GeometryNodeTransform').length, 1);
assert(inArea({ nodeEditor: editor }, () => keys({ type: 'TAB', value: 'PRESS', ctrl: true })));
assert.equal(tree.graph.name, group.name, 'Ctrl Tab goes back to the modifier\'s group');
