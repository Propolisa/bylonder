import { openBlend } from '@workbench/sdk';

// rendering.blend, made in Blender by rendering.py and opened with Blender's reader: a table by a window in late sun,
// glass, copper and a bowl of lemons, for Rendered shading and Render Image.
export async function createScene() {
  const scene = new BABYLON.Scene(engine);
  await openBlend('rendering.blend', scene);
  return scene;
}
