import { openBlend } from '@workbench/sdk';

// chess.blend, made in Blender by chess.py and opened with Blender's reader: turned chess pieces on a board, lit by
// one low spot light, seen by a camera.
export async function createScene() {
  const scene = new BABYLON.Scene(engine);
  await openBlend('chess.blend', scene);
  return scene;
}
