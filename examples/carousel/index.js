import { openBlend } from '@workbench/sdk';

// carousel.blend, made in Blender by carousel.py and opened with Blender's reader: a carousel whose riders share
// two actions, placed as strips in the Nonlinear Animation editor.
export async function createScene() {
  const scene = new BABYLON.Scene(engine);
  await openBlend('carousel.blend', scene);
  return scene;
}
