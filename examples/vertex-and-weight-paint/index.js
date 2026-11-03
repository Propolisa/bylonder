import { openBlend } from '@workbench/sdk';

// vertex-and-weight-paint.blend, made in Blender by vertex-and-weight-paint.py and opened with Blender's reader: two
// koi whose markings are a painted color attribute and whose tails swing by a weight painted vertex group.
export async function createScene() {
  const scene = new BABYLON.Scene(engine);
  await openBlend('vertex-and-weight-paint.blend', scene);
  return scene;
}
