import { openBlend } from '@workbench/sdk';

// link-append.blend, made in Blender by link-append.py and opened with Blender's reader: a street at dusk, the Street
// Lamp collection linked from libraries/library.blend and instanced along it, the bench and the cobblestone material
// appended from it. The project keeps the library, so Blender's reader finds it at /libraries/library.blend.
export async function createScene() {
  const scene = new BABYLON.Scene(engine);
  await openBlend('link-append.blend', scene);
  return scene;
}
