import { openBlend } from '@workbench/sdk';

// meditation.blend, made in Blender by meditation.py and opened with Blender's reader: the mannequin seated in an earthen
// room, breathing, the room's light baked into lightmaps.
export async function createScene() {
  const scene = new BABYLON.Scene(engine);
  await openBlend('meditation.blend', scene);
  return scene;
}
