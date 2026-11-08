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
tree.interface.new_socket('Image', { in_out: 'OUTPUT', socket_type: 'NodeSocketColor' });
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
const groupOutput = graph.outputBlock.texture.connectedPoint.ownerBlock;
assert.equal(groupOutput.getClassName(), 'CompositorNodeGroupOutput', "the Group Output shows the composite through the view transform");
assert.equal(groupOutput.source.connectedPoint.ownerBlock, glareBlock, 'the Group Output takes the Glare');
assert.equal(glareBlock.getInputByName('Image').connectedPoint.ownerBlock, balanceBlock, 'linked as in the tree');
const rendering = balanceBlock.getInputByName('Image').connectedPoint.ownerBlock;
assert.equal(rendering.getClassName(), 'CompositorNodeRLayers', "Render Layers' Image is the main rendering, through the reroute");
assert.deepEqual(rendering.declaration.outputs.slice(0, 2).map((s) => s.name), ['Image', 'Alpha'], "drawn with Blender's sockets");
assert.equal(balanceBlock.values.Fac, 0.25, "the file's values");
assert.equal(glareBlock.values.Type, 'Bloom', "the file's menu items");
assert.ok(block('CompositorNodeViewer'), 'a Viewer is shown');
assert.deepEqual(graph.editorData.locations.find((l) => l.blockId === rendering.uniqueId), { blockId: rendering.uniqueId, x: -300, y: -120, isCollapsed: false }, "placed where the file's nodes are");
assert.ok(notices.some((n) => n.includes('CompositorNodeGlare') && !n.includes('CompositorNodeViewer')), 'the nodes not run are named');
console.log("Compositor: a .blend's compositing node group opens as the compositor's graph");
