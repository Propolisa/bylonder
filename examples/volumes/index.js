import { openBlend } from '@workbench/sdk';

// volumes.blend, made in Blender by volumes.py and opened with Blender's reader: a dusty temple hall at sunset, the sun
// through its windows into drifting dust, for Rendered shading and Render Image.
export async function createScene() {
  const scene = new BABYLON.Scene(engine);
  await openBlend('volumes.blend', scene);
  return scene;
}
