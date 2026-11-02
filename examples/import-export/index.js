import { openBlend } from '@workbench/sdk';

// import-export.blend, made in Blender by import-export.py and opened with Blender's reader: the Default Cube's scene
// with the cube deleted and Suzanne imported from suzanne.obj and suzanne.mtl by Blender's OBJ importer.
export async function createScene() {
  const scene = new BABYLON.Scene(engine);
  await openBlend('import-export.blend', scene);
  return scene;
}
