import { openBlend } from '@workbench/sdk';

// particle-hair.blend, made in Blender by particle-hair.py and opened with Blender's reader: a hill of grass, a hair
// particle system combed by the wind.
export async function createScene() {
  const scene = new BABYLON.Scene(engine);
  await openBlend('particle-hair.blend', scene);
  return scene;
}
