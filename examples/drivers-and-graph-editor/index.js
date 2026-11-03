import { openBlend } from '@workbench/sdk';

// drivers-and-graph-editor.blend, made in Blender by drivers-and-graph-editor.py and opened with Blender's reader: a
// steam engine whose flywheel is keyed and whose rod, crosshead and governor follow it by drivers.
export async function createScene() {
  const scene = new BABYLON.Scene(engine);
  await openBlend('drivers-and-graph-editor.blend', scene);
  return scene;
}
