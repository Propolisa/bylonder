import { openBlend } from '@workbench/sdk';

// blue-planet.blend, made in Blender by blue-planet.py and opened with Blender's reader.
export async function createScene() {
  const scene = new BABYLON.Scene(engine);
  await openBlend('blue-planet.blend', scene);
  return scene;
}
