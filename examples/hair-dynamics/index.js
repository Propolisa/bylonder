import { openBlend } from '@workbench/sdk';

// hair-dynamics.blend, made in Blender by hair-dynamics.py and opened with Blender's reader: the head, its hair curves
// with Generate Hair Curves and Hair Dynamics, which Blender's geometry nodes simulate as the scene plays.
export async function createScene() {
  const scene = new BABYLON.Scene(engine);
  await openBlend('hair-dynamics.blend', scene);
  return scene;
}
