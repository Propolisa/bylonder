import { Color4, Constants } from '@babylonjs/core';

// The depth of what a camera sees, before it draws: each pixel's view space distance (Babylon's DepthRenderer with
// camera space Z), far where nothing is. Made the first time a material asks for it, as EEVEE's hi-Z buffer is there
// for the materials that read it (an Ambient Occlusion node).
const reading = new WeakSet();
// A material of the scene reads its depth (built with it).
export const readsSceneDepth = (scene) => reading.add(scene);
const depthRenderer = (scene, camera) => {
  reading.add(scene);
  const renderer = scene.enableDepthRenderer(camera, false, true, Constants.TEXTURE_NEAREST_SAMPLINGMODE, true);
  renderer.clearColor = FAR;
  return renderer;
};
export const sceneDepth = (scene, camera = scene.activeCamera) => depthRenderer(scene, camera).getDepthMap();
const FAR = new Color4(1e8, 0, 0, 1);
// Before a render's first sample, where a material reads the depth: the camera's made and its shaders ready, so the
// first sample's depth is drawn before the materials read it.
export async function readySceneDepth(scene, camera) {
  if (!reading.has(scene)) return;
  const renderer = depthRenderer(scene, camera);
  const drawn = (mesh) => !mesh.isEnabled() || !mesh.isVisible || !mesh.subMeshes || mesh.subMeshes.every((subMesh) => renderer.isReady(subMesh, !!mesh.hasInstances || !!mesh.hasThinInstances));
  while (!scene.meshes.every(drawn)) await new Promise((resolve) => setTimeout(resolve, 16));
}
