// Babylon's graphs restore links walking down from blocks without inputs, so a block whose inputs are all unlinked
// (a Blender node with its values on the node, as Blender's Math node usually is) loads with its outputs unlinked.
// Restoring from every block whose saved inputs are all unlinked too keeps those links.
import { NodeMaterial, NodeRenderGraph } from '@babylonjs/core';

for (const Graph of [NodeMaterial, NodeRenderGraph]) {
  const restore = Graph.prototype._restoreConnections, done = new WeakSet();
  Graph.prototype._restoreConnections = function (block, source, map) {
    restore.call(this, block, source, map);
    if (done.has(source)) return;
    done.add(source);
    for (const parsed of source.blocks) {
      if (parsed.inputs?.length && parsed.inputs.every((input) => input.targetBlockId === undefined) && map[parsed.id]) restore.call(this, map[parsed.id], source, map);
    }
  };
}
