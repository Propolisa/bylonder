import { openBlend } from '@workbench/sdk';

// lava.blend, made in Blender by lava.py and opened with Blender's reader: a sphere displaced by a Clouds texture, with
// a lava material made of Blender's shader nodes.
export async function createScene() {
  const scene = new BABYLON.Scene(engine);
  await openBlend('lava.blend', scene);
  return scene;
}
