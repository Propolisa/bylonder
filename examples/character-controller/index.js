import { openBlend } from '@workbench/sdk';

// character-controller.blend, made in Blender by character-controller.py and opened with Blender's reader: Snow on
// uneven ground with its locomotion clips, which a Character plays (docs/character-animation.md).
export async function createScene() {
  const scene = new BABYLON.Scene(engine);
  await openBlend('character-controller.blend', scene);
  return scene;
}
