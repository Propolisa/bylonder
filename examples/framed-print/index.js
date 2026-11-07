import { openBlend } from '@workbench/sdk';

// framed-print.blend, made in Blender by framed-print.py and opened with Blender's reader.
export async function createScene() {
  const scene = new BABYLON.Scene(engine);
  await openBlend('framed-print.blend', scene);
  return scene;
}
