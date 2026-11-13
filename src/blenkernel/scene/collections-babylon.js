import { nodeId } from '../../editors/object/identity.js';
import { hideMesh } from './mesh-hiding.js';

// Babylon adapter for collection visibility. Babylon has no collections, so an object hidden by its collections
// (excluded, hidden in the view layer, disabled in viewports or, in a render, disabled in renders like the object
// itself) is hidden as a mesh alone (mesh-hiding.js), like Blender, not its children.
export function createCollectionVisibility(world) {
  const meshes = () => world.objects.filter((node) => 'isVisible' in node);
  return {
    apply(resolved, render) {
      for (const node of meshes()) {
        hideMesh(node, 'collection', !((resolved.get(nodeId(node))?.visible ?? true) && !(render && node.metadata?.wbHideRender)));
        // Instancing hides differently in a render (Show Instancer for Render, the instanced original).
        const ob = world.mainSync?.objectOf(node);
        if (ob) hideMesh(node, 'instancing', world.mainSync.blender.instancingHides(ob, render));
      }
    },
    dispose() { for (const node of meshes()) hideMesh(node, 'collection', false); },
  };
}
