import { openBlend } from '@workbench/sdk';

// arrays.blend, made in Blender by arrays.py and opened with Blender's reader: a spiral stair whose step, posts and
// handrail are each one piece repeated by an Array modifier with the Turn empty as its Object Offset.
export async function createScene() {
  const scene = new BABYLON.Scene(engine);
  await openBlend('arrays.blend', scene);
  return scene;
}
