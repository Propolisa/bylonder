// A .blend's compositing node group opens as the compositor's graph (main-view.js adoptScene, compositor-tree.js): its
// Render Layers is the main rendering, its Group Output the output block, its other nodes Blender's blocks with the
// file's values and menus, linked as in the tree through its reroutes; nodes Bylonder does not run are named.
import assert from 'node:assert/strict';
import { NullEngine, Scene } from '@babylonjs/core';
import { createAnimationModel } from '../src/blenkernel/animation/model.js';
import { createSceneSettings } from '../src/blenkernel/scene/settings.js';
import { createRenderSettings } from '../src/blenkernel/scene/render.js';
import { createCollections } from '../src/blenkernel/scene/collections.js';
import { createMaterialLibrary } from '../src/blenkernel/material/library.js';
import { createWorlds } from '../src/blenkernel/scene/world.js';
import { createRNA } from '../src/makesrna/rna-bylonder.js';
import { createMainSync } from '../src/blenkernel/main-sync.js';
import { createCompositor } from '../src/compositor/compositor.js';
import { blendData, idStruct } from '../src/python/bpy_rna.js';
import '../src/python/bpy_interface.js';
import { kw } from '../src/windowmanager/wm-operators.js';

const notices = [];
const open = (bytes) => {
  const scene = new Scene(new NullEngine()), animation = createAnimationModel();
  const world = { scene, objects: Object.assign([], { scene }), animation };
  world.sceneSettings = createSceneSettings(world);
  world.renderSettings = createRenderSettings(world);
  world.collections = createCollections(world);
  world.materials = createMaterialLibrary(world);
  world.worlds = createWorlds(world);
  world.compositor = createCompositor(world, { notify: (message) => notices.push(message) });
  const sync = createMainSync({ rna: createRNA({ world }), ids: animation.ids });
  if (bytes) sync.readBlend(bytes, scene);
  return { world, sync };
};

// A file with a compositing node group, made in Main as Blender's Python would.
const { sync } = open();
const tree = blendData().node_groups.new('Compositor Nodes', 'CompositorNodeTree');
tree.interface.new_socket(kw({ name: 'Image', in_out: 'OUTPUT', socket_type: 'NodeSocketColor' }));
idStruct(sync.blender.scene).compositing_node_group = tree;
const { nodes, links } = tree;
const layers = nodes.new('CompositorNodeRLayers'), output = nodes.new('NodeGroupOutput'), reroute = nodes.new('NodeReroute');
const balance = nodes.new('CompositorNodeColorBalance'), glare = nodes.new('CompositorNodeGlare'), viewer = nodes.new('CompositorNodeViewer');
balance.inputs.get('Fac').default_value = 0.25;
glare.inputs.get('Type').default_value = 'Bloom';
layers.location = [-300, 120];
links.new(layers.outputs.get('Image'), reroute.inputs[0]);
links.new(reroute.outputs[0], balance.inputs.get('Image'));
links.new(balance.outputs.get('Image'), glare.inputs.get('Image'));
links.new(glare.outputs.get('Image'), output.inputs[0]);
links.new(glare.outputs.get('Image'), viewer.inputs.get('Image'));

const { world } = open(sync.blender.writeBlend('/compositing.blend'));
await new Promise((resolve) => setTimeout(resolve));
const { graph } = world.compositor;
assert.ok(graph, "the file's compositing node group is the compositor's graph");
const block = (idname) => graph.attachedBlocks.find((b) => b.idname === idname);
const glareBlock = block('CompositorNodeGlare'), balanceBlock = block('CompositorNodeColorBalance');
const groupOutput = graph.outputBlock;
assert.equal(groupOutput.getClassName(), 'CompositorNodeGroupOutput', "the Group Output is the graph's output, the composite the view displays");
assert.equal(groupOutput.texture.connectedPoint.ownerBlock, glareBlock, 'the Group Output takes the Glare');
assert.equal(glareBlock.getInputByName('Image').connectedPoint.ownerBlock, balanceBlock, 'linked as in the tree');
const rendering = balanceBlock.getInputByName('Image').connectedPoint.ownerBlock;
assert.equal(rendering.getClassName(), 'CompositorNodeRLayers', "Render Layers' Image is the main rendering, through the reroute");
assert.deepEqual(rendering.declaration.outputs.slice(0, 2).map((s) => s.name), ['Image', 'Alpha'], "drawn with Blender's sockets");
assert.equal(balanceBlock.values.Fac, 0.25, "the file's values");
assert.equal(glareBlock.values.Type, 'Bloom', "the file's menu items");
assert.ok(block('CompositorNodeViewer'), 'a Viewer is shown');
assert.deepEqual(graph.editorData.locations.find((l) => l.blockId === rendering.uniqueId), { blockId: rendering.uniqueId, x: -300, y: -120, isCollapsed: false }, "placed where the file's nodes are");
// Glare runs, replayed as Blender's GPU compositor records it (compositor-replay.js); a Viewer is not composited.
assert.ok(!notices.some((n) => n.includes('CompositorNodeGlare') || n.includes('CompositorNodeViewer')), 'Glare runs in the views');
console.log("Compositor: a .blend's compositing node group opens as the compositor's graph");

// The Compositor edits Main's group as Blender's (main-node-tree.js): the graph follows each edit, a value on its block,
// a new node, link or mute rebuilt from the tree (a NullEngine builds no frame graph: the graph is checked, not drawn).
const { world: edited, sync: editedSync } = open(sync.blender.writeBlend('/compositing.blend'));
await new Promise((resolve) => setTimeout(resolve));
const c = edited.compositor, group = idStruct(editedSync.blender.scene).compositing_node_group;
assert.ok(c.main, "the graph is Main's compositing node group, the tree final renders composite");
// A NullEngine cannot build the views' frame graph: the scene still composites its tree in final renders.
assert.ok(c.onCPU, "final renders composite Main's group though the views cannot draw it");
const before = c.graph;
group.nodes.get('Color Balance').inputs.get('Fac').default_value = 0.75;
await c.edit();
assert.equal(c.graph, before, 'a value is set on the block, without a rebuild');
assert.equal(c.graph.attachedBlocks.find((b) => b.idname === 'CompositorNodeColorBalance').values.Fac, 0.75, "the value Blender's tree holds");
const invert = group.nodes.new('CompositorNodeInvert');
group.links.new(group.nodes.get('Glare').outputs.get('Image'), invert.inputs.get('Color'));
group.links.new(invert.outputs.get('Color'), group.nodes.get('Group Output').inputs[0]);
group.nodes.get('Glare').mute = true;
await c.edit();
const invertBlock = c.graph.attachedBlocks.find((b) => b.idname === 'CompositorNodeInvert');
assert.equal(c.graph.outputBlock.texture.connectedPoint.ownerBlock, invertBlock, "a node added and linked in Blender's tree is composited");
assert.ok(c.graph.attachedBlocks.find((b) => b.idname === 'CompositorNodeGlare').mute, 'a muted node is muted');
await c.remove();
assert.equal(idStruct(editedSync.blender.scene).compositing_node_group, null, "the X unlinks the scene's group");

// New: Blender's own new compositing node group (node.new_compositing_node_group), the scene's.
const { world: fresh, sync: freshSync } = open();
await fresh.compositor.setEnabled(true);
const made = idStruct(freshSync.blender.scene).compositing_node_group;
assert.ok(made && fresh.compositor.main, "New makes Blender's compositing node group, the scene's");
assert.ok([...made.nodes].some((n) => n.bl_idname === 'CompositorNodeRLayers'), 'with Render Layers into the Group Output');
console.log("Compositor: edits to Main's compositing node group are composited");
// The Compositor draws the group as Blender's node editor: a 2D vector (Ellipse Mask's Position) has two fields, a
// menu socket its items, and the inputs a menu leaves unused (Color Balance's Offset under Lift/Gamma/Gain) are left out.
const { createMainNodeTree } = await import('../src/editors/space_node/main-node-tree.js');
const drawn = createMainNodeTree(made, { kind: 'compositor' });
const ellipse = made.nodes.new('CompositorNodeEllipseMask'), grade = made.nodes.new('CompositorNodeColorBalance');
freshSync.blender.evaluate();
const inputs = (node) => drawn.node(drawn.blocks().find((b) => b.rna.name === node.name)).inputs;
assert.equal(inputs(ellipse).find((s) => s.id === 'Position').value.socket.size, 2, 'a 2D vector has two fields');
assert.ok(inputs(ellipse).find((s) => s.id === 'Operation').value.socket.items.includes('Multiply'), "a menu socket's items");
assert.ok(!inputs(grade).some((s) => s.id === 'Base Offset') && inputs(grade).some((s) => s.id === 'Base Gain'), "the inputs its menu uses");
console.log("Compositor: Main's group is drawn as Blender's node editor draws it");
// A node Blender 5 no longer defines (a file's old Texture node) composites nothing in Blender either: not reported.
const { compositorGraph } = await import('../src/compositor/compositor-tree.js');
const old = compositorGraph({ name: 'Old', nodes: [{ name: 'Texture', idname: 'Undefined[CompositorNodeTexture]' }], links: [] }, new Scene(new NullEngine()));
assert.deepEqual(old.missing, []);
console.log('Compositor: nodes Blender no longer defines are not reported');
