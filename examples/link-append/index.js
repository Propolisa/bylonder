import { openBlend } from '@workbench/sdk';

// link-append.blend, made in Blender by link-append.py and opened with Blender's reader: the Default Cube's scene with
// the cube deleted, the Props collection linked from libraries/library.blend and made a library override, and the lamp
// post appended from it. The project keeps the library, so Blender's reader finds it at /libraries/library.blend.
export async function createScene() {
  const scene = new BABYLON.Scene(engine);
  await openBlend('link-append.blend', scene);
  return scene;
}
