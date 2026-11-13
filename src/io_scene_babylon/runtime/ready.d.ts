/**
 * Meshes whose shader failed to compile draw with the default material; reported. @param {import('@babylonjs/core').Scene} scene
 * @returns {string[]} what fell back
 */
export function fallBack(scene: import("@babylonjs/core").Scene): string[];
/**
 * Slow meshes draw with the default material while their own keeps compiling (asked before each frame), and get it
 * back once it is ready.
 * @param {import('@babylonjs/core').Scene} scene @param {import('@babylonjs/core').AbstractMesh[]} meshes
 */
export function standIn(scene: import("@babylonjs/core").Scene, meshes: import("@babylonjs/core").AbstractMesh[]): void;
/**
 * Resolves once the scene is ready to draw, or after `patience` with what is still compiling standing in.
 * @param {import('@babylonjs/core').Scene} scene @param {{ every?: number, patience?: number }} [options] ms
 */
export function whenDrawable(scene: import("@babylonjs/core").Scene, { every, patience }?: {
    every?: number;
    patience?: number;
}): Promise<void>;
