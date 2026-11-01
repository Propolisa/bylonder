import { openBlend } from '@workbench/sdk';

// rigged-character.blend, made in Blender by rigged-character.py and opened with Blender's reader: a figure skinned to a
// humanoid armature with automatic weights, ready to pose.
export async function createScene() {
  const scene = new BABYLON.Scene(engine);
  await openBlend('rigged-character.blend', scene);
  return scene;
}
