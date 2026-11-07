import { openBlend } from '@workbench/sdk';

// tin-cans.blend, made in Blender by tin-cans.py and opened with Blender's reader.
export async function createScene() {
  const scene = new BABYLON.Scene(engine);
  await openBlend('tin-cans.blend', scene);
  return scene;
}
