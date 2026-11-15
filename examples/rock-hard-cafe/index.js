import { openBlend } from '@workbench/sdk';

// rock-hard-cafe.blend, made in Blender by cafe.py and opened with Blender's reader: the café the game in src/ plays.
export async function createScene() {
  const scene = new BABYLON.Scene(engine);
  await openBlend('rock-hard-cafe.blend', scene);
  return scene;
}
