import { openBlend } from '@workbench/sdk';

// lotus.blend, made in Blender by lotus.py and opened with Blender's reader: lotus flowers opened from a bud by
// shape keys, the front one keyed to bloom.
export async function createScene() {
  const scene = new BABYLON.Scene(engine);
  await openBlend('lotus.blend', scene);
  return scene;
}
