import { openBlend } from '@workbench/sdk';

// neon-sign.blend, made in Blender by neon-sign.py and opened with Blender's reader.
export async function createScene() {
  const scene = new BABYLON.Scene(engine);
  await openBlend('neon-sign.blend', scene);
  return scene;
}
