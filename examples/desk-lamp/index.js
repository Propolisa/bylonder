import { openBlend } from '@workbench/sdk';

// desk-lamp.blend, made in Blender by desk-lamp.py and opened with Blender's reader: a desk lamp skinned to a
// four bone rig, its light parented to the Head bone.
export async function createScene() {
  const scene = new BABYLON.Scene(engine);
  await openBlend('desk-lamp.blend', scene);
  return scene;
}
