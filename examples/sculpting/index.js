import { openBlend } from '@workbench/sdk';

// sculpting.blend, made in Blender by sculpting.py and opened with Blender's reader: a glazed ceramic owl on a plinth,
// ready to sculpt further in Sculpt Mode.
export async function createScene() {
  const scene = new BABYLON.Scene(engine);
  await openBlend('sculpting.blend', scene);
  return scene;
}
