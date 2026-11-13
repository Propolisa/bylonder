/** The scene's collision world, made the first time a character asks. @param {import('@babylonjs/core').Scene} scene @param {number} step */
export function collisionWorld(scene: import("@babylonjs/core").Scene, step: number): {
    meshes: {
        mesh: import("@babylonjs/core").AbstractMesh;
        tris: Float32Array;
        stamps: Uint32Array;
        keys: number[];
        placed: Float32Array;
        moved: boolean;
    }[];
    /**
     * The highest ground under (x, z) from `top` down `length`, among the meshes `allowed` lets in, or null. The hit
     * is reused by the next call.
     * @param {number} x @param {number} z @param {number} top @param {number} length @param {Uint8Array} allowed
     */
    ground(x: number, z: number, top: number, length: number, allowed: Uint8Array): {
        height: number;
        normal: Vector3;
    } | null;
    /**
     * Pushes a sphere at (x, y, z) of `radius` out of the triangles of the meshes `allowed` lets in, sideways only;
     * gives the push in `out` (x, z).
     * @param {number} x @param {number} y @param {number} z @param {number} radius @param {Uint8Array} allowed @param {number[]} out
     */
    push(x: number, y: number, z: number, radius: number, allowed: Uint8Array, out: number[]): number[];
};
export function shown(mesh: import("@babylonjs/core").AbstractMesh): boolean;
import { Vector3 } from '@babylonjs/core';
