import { openBlend } from '@workbench/sdk';

// texture-paint.blend, made in Blender by texture-paint.py and opened with Blender's reader: a Suzanne painted with an
// image texture over its Smart UV Project unwrap, and a sphere painted with a color attribute.
export async function createScene() {
  const scene = new BABYLON.Scene(engine);
  await openBlend('texture-paint.blend', scene);
  return scene;
}
