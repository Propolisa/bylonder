import { openBlend } from '@workbench/sdk';

// compositor.blend, made in Blender by compositor.py and opened with Blender's reader: a neon sign at night, finished in
// the compositor.
export async function createScene() {
  const scene = new BABYLON.Scene(engine);
  await openBlend('compositor.blend', scene);
  return scene;
}
