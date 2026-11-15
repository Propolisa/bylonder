// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// A scene camera, while orthographic, takes its bounds from Blender's Orthographic Scale (6 unless set), which spans the
// longer side of each view it renders (sensor fit Auto). Getters, as Babylon computes a projection before its camera
// render observers run; the scale is Main's, so Babylon's own writes are ignored.
import { Camera } from '@babylonjs/core';

/** @typedef {import('@babylonjs/core').Camera} BabylonCamera */

const ORTHO_SIDES = { orthoTop: [1, 0], orthoBottom: [-1, 0], orthoLeft: [0, -1], orthoRight: [0, 1] };
const fitted = new WeakSet();
// A camera view's half width and height in scene units, where it shows more than the scale spans (camera view).
const orthoViews = new WeakMap();

/** @param {BabylonCamera} camera @param {number[] | null} halfExtents */
export function setOrthoView(camera, halfExtents) {
  if (halfExtents) orthoViews.set(camera, halfExtents); else orthoViews.delete(camera);
}

/**
 * @template {BabylonCamera} C
 * @param {C} camera
 * @returns {C}
 */
export function fitsOrthoScale(camera) {
  if (fitted.has(camera)) return camera;
  fitted.add(camera);
  const aspect = () => camera.getEngine().getAspectRatio(camera);
  const half = () => (camera.metadata?.orthoScale ?? 6) / 2 / Math.max(aspect(), 1);
  for (const [side, [up, right]] of Object.entries(ORTHO_SIDES)) {
    const get = () => { const view = orthoViews.get(camera); return view ? up * view[1] + right * view[0] : half() * (up || right * aspect()); };
    Object.defineProperty(camera, side, { configurable: true, get, set() {} });
  }
  return camera;
}

/**
 * A perspective camera exported with its render's frame (`metadata.frameAspect`, its field of view along the side its
 * sensor fits) shows that frame whole in any view, as Blender's camera view does: along the frame's width where the view
 * is narrower than the frame, along its height where it is wider. The field of view it is set to stays along the side
 * it was exported for (a lens control's writes).
 * @template {BabylonCamera} C
 * @param {C} camera
 * @returns {C}
 */
export function fitsFrame(camera) {
  const frameAspect = camera.metadata?.frameAspect;
  if (!frameAspect || fitted.has(camera)) return camera;
  fitted.add(camera);
  const exportedVertical = camera.fovMode === Camera.FOVMODE_VERTICAL_FIXED;
  let fov = camera.fov;
  const vertical = () => camera.getEngine().getAspectRatio(camera) > frameAspect;
  const along = (/** @type {boolean} */ alongHeight) => {
    if (alongHeight === exportedVertical) return fov;
    const half = Math.tan(fov / 2);
    return 2 * Math.atan(alongHeight ? half / frameAspect : half * frameAspect);
  };
  Object.defineProperty(camera, 'fovMode', { configurable: true, get: () => (vertical() ? Camera.FOVMODE_VERTICAL_FIXED : Camera.FOVMODE_HORIZONTAL_FIXED), set() {} });
  Object.defineProperty(camera, 'fov', { configurable: true, get: () => along(vertical()), set: (/** @type {number} */ value) => { fov = value; } });
  return camera;
}

/**
 * A parsed camera, its bounds from its Orthographic Scale when it is orthographic, else its render's frame whole.
 * @template {BabylonCamera} C
 * @param {C} camera
 * @returns {C}
 */
export const orthoScaled = (camera) => (camera.mode === Camera.ORTHOGRAPHIC_CAMERA ? fitsOrthoScale(camera) : fitsFrame(camera));
