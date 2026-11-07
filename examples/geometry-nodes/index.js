import { openBlend } from '@workbench/sdk';

// geometry-nodes.blend, made in Blender by geometry-nodes.py and opened with Blender's reader: a tiny planet whose
// terrain, sea, forests and clouds are one Geometry Nodes modifier.
export async function createScene() {
  const scene = new BABYLON.Scene(engine);
  await openBlend('geometry-nodes.blend', scene);
  return scene;
}
