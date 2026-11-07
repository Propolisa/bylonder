import { openBlend } from '@workbench/sdk';

// newtons-cradle.blend, made in Blender by newtons-cradle.py and opened with Blender's reader: a Newton's cradle whose
// outer balls are keyed with Sine easing.
export async function createScene() {
  const scene = new BABYLON.Scene(engine);
  await openBlend('newtons-cradle.blend', scene);
  return scene;
}
