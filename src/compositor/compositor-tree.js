// A scene's compositing node group, as a read .blend's Main holds it (plain: { nodes: [{ idname, name, properties,
// values, location }], links: [[from node, output, to node, input]] }), as Bylonder's compositor graph: Babylon's
// default render graph, its main rendering Blender's Render Layers and a Group Output before its output block (the
// view transform, compositor-io.js), with a block per Blender node in between, linked as in the tree
// (docs/node-editors.md).
import { NodeRenderGraph } from '@babylonjs/core';
import { compositorBlockClasses } from '../nodes/blender/compositor-nodes.js';
import { BlenderGroupOutputBlock, BlenderRenderLayersBlock } from '../nodes/blender/compositor-io.js';
import { declaration } from '../nodes/blender/declarations.js';
import { rerouted } from '../nodes/blender/shader-nodes.js';

const RENDER_LAYERS = 'CompositorNodeRLayers', GROUP_OUTPUT = 'NodeGroupOutput';
// Nodes the composite does not pass through: a Viewer shows an image in Blender's editors, a frame groups nodes.
const UNCOMPOSITED = ['CompositorNodeViewer', 'NodeFrame', 'NodeReroute'];

const hideFeeding = (block) => {
  if (block.name.startsWith('blender:')) return;
  block.name = 'blender:' + block.name;
  for (const input of block.inputs) if (input.connectedPoint) hideFeeding(input.connectedPoint.ownerBlock);
};

// Babylon's default graph's main rendering as Blender's Render Layers and a Group Output before its output block; what
// feeds the rendering (camera, objects, its cleared target) and the output block are helpers, not drawn.
function blenderEnds(graph, scene) {
  const babylonOutput = graph.outputBlock, babylonRendering = babylonOutput.texture.connectedPoint.ownerBlock;
  const rendering = new BlenderRenderLayersBlock(undefined, graph.frameGraph, scene), output = new BlenderGroupOutputBlock(undefined, graph.frameGraph, scene);
  for (const input of babylonRendering.inputs) {
    const from = input.connectedPoint;
    if (!from) continue;
    from.disconnectFrom(input);
    from.connectTo(rendering.getInputByName(input.name));
    hideFeeding(from.ownerBlock);
  }
  babylonRendering.output.disconnectFrom(babylonOutput.texture);
  babylonRendering.dispose();
  rendering.output.connectTo(output.source);
  output.output.connectTo(babylonOutput.texture);
  babylonOutput.name = 'blender:Output';
  graph.attachedBlocks.push(rendering, output);
  return { rendering, output };
}

// Returns the graph and the node types it does not run (left out, or passing their image through).
export function compositorGraph(tree, scene, name = 'Compositing') {
  const graph = new NodeRenderGraph(name, scene, { rebuildGraphOnEngineResize: true });
  graph.setToDefault();
  const { rendering, output } = blenderEnds(graph, scene), missing = new Set();
  const blocks = new Map(), locations = [];
  const place = (block, node) => node.location && locations.push({ blockId: block.uniqueId, x: node.location[0], y: -node.location[1], isCollapsed: false });
  for (const node of tree.nodes) {
    if (node.idname === RENDER_LAYERS) { place(rendering, node); continue; }
    if (node.idname === GROUP_OUTPUT) { place(output, node); continue; }
    const Block = compositorBlockClasses[node.idname];
    const sockets = Block && declaration('compositor', node.idname);
    if (!sockets?.inputs.length && !sockets?.outputs.length) { if (!UNCOMPOSITED.includes(node.idname)) missing.add(node.idname); continue; }
    const block = new Block(node.name, graph.frameGraph, scene);
    Object.assign(block.properties, structuredClone(node.properties ?? {}));
    for (const [id, value] of Object.entries(node.values ?? {})) if (value !== null && id in block.values) block.values[id] = value;
    if (!block.runs && !UNCOMPOSITED.includes(node.idname)) missing.add(node.idname);
    blocks.set(node.name, block);
    graph.attachedBlocks.push(block);
    place(block, node);
  }
  const kinds = new Map(tree.nodes.map((node) => [node.name, node.idname]));
  const source = (from, socket) => (kinds.get(from) === RENDER_LAYERS ? (socket === 'Image' ? rendering.output : null)
    : blocks.get(from)?.result?.identifier === socket ? blocks.get(from).getOutputByName(socket) : null);
  const groupOutput = tree.nodes.find((node) => node.idname === GROUP_OUTPUT);
  for (const [from, socket, to, input] of rerouted(tree)) {
    const out = source(from, socket);
    if (to === groupOutput?.name) {
      if (out && input === Object.keys(groupOutput.values ?? {})[0]) { output.source.connectedPoint?.disconnectFrom(output.source); out.connectTo(output.source); }
      continue;
    }
    const target = blocks.get(to)?.getInputByName(input);
    if (out && target) out.connectTo(target);
  }
  graph.editorData = { locations, frames: [] };
  return { graph, missing: [...missing] };
}
