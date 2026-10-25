import { EngineStore, GeometryOutputBlock, Mesh, MeshBlock, NodeGeometry, VertexData } from '@babylonjs/core';

const graphs = new Map();
let evaluating = false;
export const isEvaluating = () => evaluating;
export function defaultGeometryGraph() {
  const graph = new NodeGeometry('Geometry Nodes');
  const input = new MeshBlock('Group Input');
  const output = new GeometryOutputBlock('Group Output');
  input.geometry.connectTo(output.geometry);
  graph.outputBlock = output;
  graph.attachedBlocks.push(input, output);
  return JSON.stringify(graph.serialize());
}
export function geometryGraph(modifier) {
  let entry = graphs.get(modifier.id);
  if (!entry || entry.json !== modifier.values.graph) {
    entry?.graph.dispose();
    const graph = new NodeGeometry(modifier.name);
    graph.parseSerializedObject(JSON.parse(modifier.values.graph || defaultGeometryGraph()));
    entry = { json: modifier.values.graph, graph };
    graphs.set(modifier.id, entry);
  }
  return entry.graph;
}
export function storeGeometryGraph(modifier) {
  const graph = graphs.get(modifier.id)?.graph;
  if (!graph) return;
  modifier.values.graph = JSON.stringify(graph.serialize());
  graphs.get(modifier.id).json = modifier.values.graph;
}

let carrier;
export const geometryNodesDefinition = {
  id: 'NODES', name: 'GeometryNodes', category: 'Generate', icon: 'GEOMETRY_NODES',
  schema: { graph: { label: 'Node Group', default: '', animatable: false, hidden: true } },
  defaults: () => ({ graph: defaultGeometryGraph() }),
  evaluate(input, modifier) {
    const graph = geometryGraph(modifier);
    const scene = EngineStore.LastCreatedScene;
    if (!carrier || carrier.isDisposed() || carrier.getScene() !== scene) {
      carrier = new Mesh('__geometryNodesInput', scene);
      carrier.setEnabled(false);
      carrier.isPickable = false;
      carrier.metadata = { editable: false };
      carrier.doNotSerialize = true;
    }
    VertexData.Parse(input.data).applyToMesh(carrier, true);
    for (const block of graph.attachedBlocks) if (block.getClassName() === 'MeshBlock' && (!block.mesh || block.mesh === carrier || block.name === 'Group Input')) block.mesh = carrier;
    evaluating = true;
    try { graph.build(); } finally { evaluating = false; }
    if (!graph.vertexData) throw Error('Geometry Nodes: the node group has no output geometry.');
    return { ...input, data: graph.vertexData.serialize() };
  },
};
