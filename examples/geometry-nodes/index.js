import { openBlend } from '@workbench/sdk';

// geometry-nodes.blend, made with Blender's own code by geometry-nodes.mjs and opened with Blender's reader: a meadow
// whose Geometry Nodes modifier scatters trees, a node group, scaled by a named attribute.
export async function createScene() {
  const scene = new BABYLON.Scene(engine);
  await openBlend('geometry-nodes.blend', scene);
  return scene;
}
