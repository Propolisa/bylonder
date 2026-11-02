import { openBlend } from '@workbench/sdk';

// nla.blend, made in Blender by nla.py and opened with Blender's reader: a box whose Slide, Hop and Turn actions are
// layered as strips in the Nonlinear Animation editor.
export async function createScene() {
  const scene = new BABYLON.Scene(engine);
  await openBlend('nla.blend', scene);
  return scene;
}
