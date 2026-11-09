/**
 * The Blender fallback's interface (bylonder-blender/blender.js).
 * @typedef {{ set(path: string, value: any): void, evaluate(frame: number): void }} Blend
 */
/**
 * @param {import('./scheduler.js').Page} page its controls' defaults are what Main holds in scene.blend
 * @returns {Promise<import('./scheduler.js').Evaluator>}
 */
export function load({ scene, root, controls: { paths, defaults } }: import("./scheduler.js").Page): Promise<import("./scheduler.js").Evaluator>;
/**
 * The Blender fallback's interface (bylonder-blender/blender.js).
 */
export type Blend = {
    set(path: string, value: any): void;
    evaluate(frame: number): void;
};
