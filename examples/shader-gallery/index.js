import { openBlend } from '@workbench/sdk';

// shader_gallery.blend, made in Blender by shader_gallery.py and opened with Blender's reader: sixteen spheres, each
// with a material of Blender's common shader nodes.
export async function createScene() {
  const scene = new BABYLON.Scene(engine);
  await openBlend('shader_gallery.blend', scene);
  return scene;
}
