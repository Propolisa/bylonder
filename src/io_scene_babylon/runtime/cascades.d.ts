/**
 * Fits the scene's cascaded shadow generators to the view whenever the camera's view or projection changes. Returns
 * what stops it.
 * @param {import('@babylonjs/core').Scene} scene
 */
export function fitCascades(scene: import("@babylonjs/core").Scene): () => boolean;
