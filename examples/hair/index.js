import { openBlend } from '@workbench/sdk';

// hair.blend, made in Blender by hair.py and opened with Blender's reader: the head, its combed hair particle system
// and their materials.
export async function createScene() {
  const scene = new BABYLON.Scene(engine);
  await openBlend('hair.blend', scene);
  return scene;
}
