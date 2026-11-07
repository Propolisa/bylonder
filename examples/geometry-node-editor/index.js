import { openBlend } from '@workbench/sdk';

// geometry-node-editor.blend, made in Blender by geometry-node-editor.py and opened with Blender's reader: sunflowers
// whose seeds and petals a Geometry Nodes group lays out by the golden angle.
export async function createScene() {
  const scene = new BABYLON.Scene(engine);
  await openBlend('geometry-node-editor.blend', scene);
  return scene;
}
