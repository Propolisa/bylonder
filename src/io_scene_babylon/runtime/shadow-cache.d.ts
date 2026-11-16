/**
 * Caches the still casters of each cascaded shadow map of the scene's lights. Returns what turns it off.
 * @param {import('@babylonjs/core').Scene} scene
 * @param {(node: any) => boolean} moves whether something moves a node itself (an animation, a constraint, a moving body)
 */
export function cacheStillShadows(scene: import("@babylonjs/core").Scene, moves: (node: any) => boolean): () => void;
