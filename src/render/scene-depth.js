import { Color4, Constants } from '@babylonjs/core';

// The depth of what a camera sees, before it draws: each pixel's view space distance (Babylon's DepthRenderer with
// camera space Z), far where nothing is. Made the first time a material asks for it, as EEVEE's hi-Z buffer is there
// for the materials that read it (an Ambient Occlusion node).
export function sceneDepth(scene, camera = scene.activeCamera) {
  const renderer = scene.enableDepthRenderer(camera, false, true, Constants.TEXTURE_NEAREST_SAMPLINGMODE, true);
  renderer.clearColor = FAR;
  return renderer.getDepthMap();
}
const FAR = new Color4(1e8, 0, 0, 1);
