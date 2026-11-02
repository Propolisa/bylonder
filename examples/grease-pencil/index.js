import { openBlend } from '@workbench/sdk';

// grease-pencil.blend, made in Blender by grease-pencil.py and opened with Blender's reader: a ball drawn on twos that
// bounces twice, its shadow and the ground, in Grease Pencil layers seen by a camera.
export async function createScene() {
  const scene = new BABYLON.Scene(engine);
  await openBlend('grease-pencil.blend', scene);
  return scene;
}
