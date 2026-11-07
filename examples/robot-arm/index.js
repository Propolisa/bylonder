import { openBlend } from '@workbench/sdk';

// robot-arm.blend, made in Blender by robot-arm.py and opened with Blender's reader: a robot arm skinned to the Arm
// Rig armature, its work light parented to the Head bone, over a brass gear on a workbench at night.
export async function createScene() {
  const scene = new BABYLON.Scene(engine);
  await openBlend('robot-arm.blend', scene);
  return scene;
}
