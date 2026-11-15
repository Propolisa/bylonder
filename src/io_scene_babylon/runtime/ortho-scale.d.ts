/** @param {BabylonCamera} camera @param {number[] | null} halfExtents */
export function setOrthoView(camera: BabylonCamera, halfExtents: number[] | null): void;
/**
 * @template {BabylonCamera} C
 * @param {C} camera
 * @returns {C}
 */
export function fitsOrthoScale<C extends BabylonCamera>(camera: C): C;
/**
 * A perspective camera exported with its render's frame (`metadata.frameAspect`, its field of view along the side its
 * sensor fits) shows that frame whole in any view, as Blender's camera view does: along the frame's width where the view
 * is narrower than the frame, along its height where it is wider. The field of view it is set to stays along the side
 * it was exported for (a lens control's writes).
 * @template {BabylonCamera} C
 * @param {C} camera
 * @returns {C}
 */
export function fitsFrame<C extends BabylonCamera>(camera: C): C;
export function orthoScaled<C extends BabylonCamera>(camera: C): C;
export type BabylonCamera = import("@babylonjs/core").Camera;
