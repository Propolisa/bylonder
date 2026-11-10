/** @param {BabylonCamera} camera @param {number[] | null} halfExtents */
export function setOrthoView(camera: BabylonCamera, halfExtents: number[] | null): void;
/**
 * @template {BabylonCamera} C
 * @param {C} camera
 * @returns {C}
 */
export function fitsOrthoScale<C extends BabylonCamera>(camera: C): C;
export function orthoScaled<C extends BabylonCamera>(camera: C): C;
export type BabylonCamera = import("@babylonjs/core").Camera;
