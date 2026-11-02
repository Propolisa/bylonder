import { openBlend } from '@workbench/sdk';

// Blender 5.2's 2D Animation application template (File > New > 2D Animation): its startup.blend, opened with Blender's
// reader, a camera and an empty Grease Pencil object in Draw Mode.
export async function createScene() {
  const scene = new BABYLON.Scene(engine);
  await openBlend('startup.blend', scene);
  return scene;
}
