import { openBlend } from '@workbench/sdk';

// python.blend, made in Blender by python.py and opened with Blender's reader: a beach, a sun and a camera, the
// seashell that the seashell.py text builds (Alt P in the Text Editor rebuilds it), and the scatter_cubes.py add-on.
export async function createScene() {
  const scene = new BABYLON.Scene(engine);
  await openBlend('python.blend', scene);
  return scene;
}
