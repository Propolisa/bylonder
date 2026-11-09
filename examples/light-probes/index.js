import { openBlend } from '@workbench/sdk';

// light-probes.blend, made in Blender by light-probes.py and opened with Blender's reader.
export async function createScene() {
  const scene = new BABYLON.Scene(engine);
  await openBlend('light-probes.blend', scene);
  return scene;
}
