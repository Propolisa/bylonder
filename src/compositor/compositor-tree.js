// A scene's compositing node group, as a read .blend's Main holds it (plain: { nodes: [{ idname, name, properties,
// values, location }], links: [[from node, output, to node, input]] }), as Bylonder's compositor graph: Babylon's
// default render graph, whose main rendering is the Render Layers node's Image and whose output block is the Group
// Output, with a block per Blender node in between, linked as in the tree (docs/node-editors.md).
import { NodeRenderGraph } from '@babylonjs/core';
import { compositorBlockClasses } from '../nodes/blender/compositor-nodes.js';
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

// Returns the graph and the node types it does not run (left out, or passing their image through).
export function compositorGraph(tree, scene, name = 'Compositing') {
  const graph = new NodeRenderGraph(name, scene, { rebuildGraphOnEngineResize: true });
  graph.setToDefault();
  const output = graph.outputBlock, rendering = output.texture.connectedPoint.ownerBlock, missing = new Set();
  // Named as Blender's nodes; what feeds the main rendering (camera, objects, its cleared target) is a helper, not drawn.
  rendering.name = 'Render Layers';
  output.name = 'Group Output';
  for (const input of rendering.inputs) if (input.connectedPoint) hideFeeding(input.connectedPoint.ownerBlock);
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
      if (out && input === Object.keys(groupOutput.values ?? {})[0]) { output.texture.connectedPoint?.disconnectFrom(output.texture); out.connectTo(output.texture); }
      continue;
    }
    const target = blocks.get(to)?.getInputByName(input);
    if (out && target) out.connectTo(target);
  }
  graph.editorData = { locations, frames: [] };
  return { graph, missing: [...missing] };
}
