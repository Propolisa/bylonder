// SPDX-License-Identifier: MIT OR Apache-2.0
// Override of Babylon's node graph loading (NodeMaterial, NodeRenderGraph _restoreConnections, patched on their prototypes): links restored from every block whose saved inputs are all unlinked too, as Babylon walks down only from blocks without inputs and loses the outputs of a block whose inputs are all unlinked; goes when Babylon restores those links.
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
