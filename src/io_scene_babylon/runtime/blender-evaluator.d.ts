/**
 * The Blender fallback's interface (bylonder-blender/blender.js).
 * @typedef {{ set(path: string, value: any): void, evaluate(frame: number): void }} Blend
 */
/**
 * @param {import('@babylonjs/core').Scene} scene
 * @param {string} root the package's URL
 * @param {{ paths: string[], defaults: any[] }} controls the package's controls, as Main holds them in scene.blend
 * @returns {Promise<import('./scheduler.js').Evaluator>}
 */
export function load(scene: import("@babylonjs/core").Scene, root: string, { paths, defaults }: {
    paths: string[];
    defaults: any[];
}): Promise<import("./scheduler.js").Evaluator>;
/**
 * The Blender fallback's interface (bylonder-blender/blender.js).
 */
export type Blend = {
    set(path: string, value: any): void;
    evaluate(frame: number): void;
};
