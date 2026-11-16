/**
 * Freezes the world matrices of a scene's still meshes until each moves. Returns what thaws them all.
 * @param {import('@babylonjs/core').Scene} scene
 * @param {(node: any) => boolean} moves whether something moves a node itself
 */
export function freezeStill(scene: import("@babylonjs/core").Scene, moves: (node: any) => boolean): () => void;
