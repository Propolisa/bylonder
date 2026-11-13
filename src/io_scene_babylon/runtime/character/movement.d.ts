/** Where a node faces, flat: its -Z, which is Blender's front (-Y) as the export turns it. */
export function facingOf(node: import("@babylonjs/core").TransformNode, out?: Vector3): Vector3;
/**
 * Where a rig faces in its own space, flat: from its ankles to its toes at rest (the role `legs`' feet and their
 * first children), else -Z (Blender's front as exported).
 * @param {{ names: string[], parents: Int32Array, rest: Float32Array, boneIndex(name: string): number }} rig @param {string[][]} legs
 */
export function restFront(rig: {
    names: string[];
    parents: Int32Array;
    rest: Float32Array;
    boneIndex(name: string): number;
}, legs: string[][]): Vector3;
/**
 * A character's movement on `node`, which it moves and turns, `front` (the way the character faces in the node's own
 * space, restFront) to the facing.
 * @param {import('@babylonjs/core').Scene} scene
 * @param {{ node: import('@babylonjs/core').TransformNode, front?: Vector3, responsiveness?: number,
 *   ground?: (string | RegExp)[] | null, height?: number, radius?: number }} options `ground` limits the ground and walls
 *   to meshes of those names
 * @returns {import('./api.js').Movement & { responsiveness: number, push(by: Vector3): void, place(position: Vector3, facing: Vector3, seconds: number): Promise<void>,
 *   turnTo(facing: Vector3, seconds: number): Promise<void>, dispose(): void }}
 */
export function createMovement(scene: import("@babylonjs/core").Scene, { node, front, responsiveness, ground, height, radius }: {
    node: import("@babylonjs/core").TransformNode;
    front?: Vector3;
    responsiveness?: number;
    ground?: (string | RegExp)[] | null;
    height?: number;
    radius?: number;
}): import("./api.js").Movement & {
    responsiveness: number;
    push(by: Vector3): void;
    place(position: Vector3, facing: Vector3, seconds: number): Promise<void>;
    turnTo(facing: Vector3, seconds: number): Promise<void>;
    dispose(): void;
};
/**
 * Intent toward `target` at walking (or running) speed, braking at BRAKING m/s² to stop on it.
 * @param {import('./api.js').Character} character @param {Target} target @param {{ run?: boolean }} [options]
 * @returns {import('./api.js').Intent}
 */
export function steer(character: import("./api.js").Character, target: Target, { run }?: {
    run?: boolean;
}): import("./api.js").Intent;
/**
 * Steers the character to `target` in place of its input, which it gets back on arrival.
 * @param {import('./api.js').Character} character @param {Target} target @param {{ run?: boolean }} [options]
 * @returns {Promise<void>}
 */
export function walkTo(character: import("./api.js").Character, target: Target, options?: {
    run?: boolean;
}): Promise<void>;
/**
 * Moves the character onto `node`'s place and facing, eased over `seconds`.
 * @param {import('./api.js').Character} character @param {import('@babylonjs/core').TransformNode} node @param {{ seconds?: number }} [options]
 * @returns {Promise<void>}
 */
export function place(character: import("./api.js").Character, node: import("@babylonjs/core").TransformNode, { seconds }?: {
    seconds?: number;
}): Promise<void>;
/**
 * Turns the character in place toward `target`, eased over `seconds`.
 * @param {import('./api.js').Character} character @param {Target} target @param {{ seconds?: number }} [options]
 * @returns {Promise<void>}
 */
export function turnTo(character: import("./api.js").Character, target: Target, { seconds }?: {
    seconds?: number;
}): Promise<void>;
export namespace DEFAULT_SPEEDS {
    let walk: number;
    let run: number;
}
export type Target = import("@babylonjs/core").TransformNode | Vector3;
import { Vector3 } from '@babylonjs/core';
