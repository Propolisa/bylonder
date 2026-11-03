import { openBlend } from '@workbench/sdk';

// mesh-modeling.blend, made in Blender by mesh-modeling.py and opened with Blender's reader: a rangefinder film camera
// modeled with Edit Mode's tools, on a desk.
export async function createScene() {
  const scene = new BABYLON.Scene(engine);
  await openBlend('mesh-modeling.blend', scene);
  return scene;
}
