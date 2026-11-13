import { openBlend } from '@workbench/sdk';

// basic-character.blend, made in Blender by basic-character.py and opened with Blender's reader: Quaternius' mannequin
// with its Idle, Walk, Run and Jump, the character animation guide's basic path.
export async function createScene() {
  const scene = new BABYLON.Scene(engine);
  await openBlend('basic-character.blend', scene);
  return scene;
}
