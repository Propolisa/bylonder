/** The streams an engine holds: in use, unused and kept, how many it has uploaded, and their buffers. @param {import('@babylonjs/core').AbstractEngine} engine */
export function sharedStreams(engine: import("@babylonjs/core").AbstractEngine): {
    used: number;
    idle: number;
    idleBytes: number;
    uploads: number;
    buffers: SharedBuffer[];
};
/**
 * A run's sharing in one line, for a page or the Game header: the shared streams it draws, the streams it deforms
 * itself, any it draws that the cache let go of, and the engine's failures to share.
 * @param {import('@babylonjs/core').Scene} scene
 */
export function sharedStatus(scene: import("@babylonjs/core").Scene): string;
/**
 * A geometry from its vertex buffers by kind (`[size, buffer]`) and its indices, arrays of scene.bin: its vertex
 * streams shared with every scene on the engine that loads the same arrays, its index buffer its own. A failure lets
 * go of what it took and asks for the run to be loaded again (`reload`), never a run half shared.
 * @param {import('@babylonjs/core').Scene} scene @param {{ vertices: Record<string, [number, string]>, indices?: string }} entry
 * @param {string} key @param {import('./buffers.js').Buffers} buffers
 */
export function sharedGeometry(scene: import("@babylonjs/core").Scene, { vertices, indices }: {
    vertices: Record<string, [number, string]>;
    indices?: string;
}, key: string, buffers: import("./buffers.js").Buffers): SharedGeometry;
/**
 * A package version's data, read once for every run of it on the page: `read` reads it when no run holds it. The IR
 * is frozen; each run gets its own table of the shared arrays, which its patches change.
 * @param {string} version the package's URL with its version @param {() => Promise<PackageData>} read
 * @returns {Promise<PackageData>}
 */
export function sharedPackage(version: string, read: () => Promise<PackageData>): Promise<PackageData>;
/**
 * A run's IR: what `read` (readIR) makes of a package's IR, once for every run of it and frozen, in a view of the run's
 * own: its clock (`scene.time`), entities and their order, which its playhead and scheduler change, and the tables a
 * patch replaces whole.
 * @template {{ scene: { time: object }, entities: object, order: string[] }} IR
 * @param {object} raw the IR as read @param {() => IR} read
 * @returns {IR}
 */
export function sharedIR<IR extends {
    scene: {
        time: object;
    };
    entities: object;
    order: string[];
}>(raw: object, read: () => IR): IR;
/** How many bytes of streams no geometry uses an engine keeps, for a run loaded again or a patch undone. */
export const IDLE_BYTES: number;
export type PackageData = {
    ir: any;
    buffers: import("./buffers.js").Buffers;
};
/** A shared stream's buffer, which throws if drawn once the cache has let go of it (a stale reference). */
declare class SharedBuffer extends Buffer {
    /** The stream's key once released. */
    released: string;
}
/** A geometry whose vertex streams are the engine's shared ones, let go of as it is disposed or its scene is. */
declare class SharedGeometry extends Geometry {
    /** @param {string} id @param {import('@babylonjs/core').Scene} scene */
    constructor(id: string, scene: import("@babylonjs/core").Scene);
    /** @param {string} kind @param {string} name scene.bin's array @param {ArrayBufferView} data @param {number} size */
    share(kind: string, name: string, data: ArrayBufferView, size: number): void;
    #private;
}
import { Buffer } from '@babylonjs/core';
import { Geometry } from '@babylonjs/core';
export {};
