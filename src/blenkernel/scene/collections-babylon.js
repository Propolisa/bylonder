import { nodeId } from '../../editors/object/identity.js';

// Babylon adapter for collection visibility. Babylon has no collections, so an object hidden by its collections
// (excluded, hidden in the view layer, disabled in viewports or, in a render, disabled in renders like the object
// itself) gets mesh.isVisible = false. That hides only the object itself, like Blender, not its children. Only meshes
// this adapter hid are ever touched, and their authored isVisible is restored when they come back.
export function createCollectionVisibility(world) {
  const hidden = new Map();
  return {
    apply(resolved, render) {
      for (const node of world.objects) {
        if (!('isVisible' in node)) continue;
        const show = (resolved.get(nodeId(node))?.visible ?? true) && !(render && node.metadata?.wbHideRender);
        if (!show && !hidden.has(node)) { hidden.set(node, node.isVisible); node.isVisible = false; }
        else if (show && hidden.has(node)) { node.isVisible = hidden.get(node); hidden.delete(node); }
      }
    },
    dispose() { for (const [node, visible] of hidden) node.isVisible = visible; hidden.clear(); },
  };
}
