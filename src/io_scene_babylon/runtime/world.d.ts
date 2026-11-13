/** @typedef {import('@babylonjs/core').Scene} Scene */
/** @typedef {import('@babylonjs/core').Material} Material */
/**
 * A world of one color (linear, times its strength), lighting the scene; `set` changes it.
 * @param {Scene} scene
 * @param {number[]} color
 */
export function worldColor(scene: Scene, color: number[]): {
    /** @param {number[]} rgb */
    set([r, g, b]: number[]): void;
};
/**
 * A world of nodes: its material on a box around the eye, and baked into the probe that lights the scene once its
 * shader is ready (a GPU's work: a page without one shows the box but bakes nothing). The probe is the scene's
 * environment at once, before the other materials are made (their PBR blocks leave out an environment made later).
 * @param {Scene} scene
 * @param {Material} material
 */
export function worldNodes(scene: Scene, material: Material): {
    box: import("@babylonjs/core").Mesh;
};
export type Scene = import("@babylonjs/core").Scene;
export type Material = import("@babylonjs/core").Material;
