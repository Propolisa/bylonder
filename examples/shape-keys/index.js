import { openBlend } from '@workbench/sdk';

// shape-keys.blend, made in Blender by shape-keys.py and opened with Blender's reader: a jelly blob whose shape keys
// squash, stretch and bulge it, two of them keyed.
export async function createScene() {
  const scene = new BABYLON.Scene(engine);
  await openBlend('shape-keys.blend', scene);
  return scene;
}
