/** Tiles packed as layers, with their map; null for none. @param {Tile[]} given @param {number} [max] @returns {Packed | null} */
export function packTiles(given: Tile[], max?: number): Packed | null;
/**
 * The array and map textures of packed tiles in a scene.
 * @param {import('@babylonjs/core').Scene} scene @param {Packed} packed @param {string} name
 * @param {number} [sampling]
 */
export function tileTextures(scene: import("@babylonjs/core").Scene, packed: Packed, name: string, sampling?: number): {
    array: RawTexture2DArray;
    map: RawTexture;
};
/**
 * Tile files as tiles, decoded by the browser: bytes, rows bottom first as Blender's buffers.
 * @param {{ number: number, url: string, srgb: boolean }[]} files
 * @returns {Promise<Tile[]>}
 */
export function decodeTiles(files: {
    number: number;
    url: string;
    srgb: boolean;
}[]): Promise<Tile[]>;
/** @typedef {{ number: number, width: number, height: number, float: boolean, srgb: boolean, pixels: Uint8Array | Float32Array }} Tile rows bottom first */
/** @typedef {{ layers: Uint8Array | Float32Array, width: number, height: number, depth: number, float: boolean, srgb: boolean, map: Float32Array, mapWidth: number }} Packed */
/** The largest tile a layer holds; larger tiles are halved until they fit. */
export const MAX_TILE: 2048;
export const TILE_BLOCK: "TileBlock";
/**
 * A UDIM image's sampler in a node material: its tiles' array (`part` 'array') or its tile map ('map'), declared as a
 * global named `samplerName`, which the material's node code reads. Its `ready` output orders it before that code.
 * The array part carries the tiles' files (`tiles`), which the page decodes; the map part finds them by `image`.
 */
export class TileBlock extends NodeMaterialBlock {
    /** @param {string} name */
    constructor(name: string);
    samplerName: string;
    /** @type {'array' | 'map'} */
    part: "array" | "map";
    image: string;
    /** @type {{ number: number, url?: string, name?: string, srgb: boolean }[]} */
    tiles: {
        number: number;
        url?: string;
        name?: string;
        srgb: boolean;
    }[];
    /** @type {import('@babylonjs/core').BaseTexture | null} */
    texture: import("@babylonjs/core").BaseTexture | null;
    get ready(): import("@babylonjs/core").NodeMaterialConnectionPoint;
    /** @param {any} state */
    _buildBlock(state: any): this;
    /** @param {import('@babylonjs/core').Effect} effect */
    bind(effect: import("@babylonjs/core").Effect): void;
    /** @param {any} serialized @param {import('@babylonjs/core').Scene} scene @param {string} rootUrl */
    _deserialize(serialized: any, scene: import("@babylonjs/core").Scene, rootUrl: string): void;
}
/**
 * rows bottom first
 */
export type Tile = {
    number: number;
    width: number;
    height: number;
    float: boolean;
    srgb: boolean;
    pixels: Uint8Array | Float32Array;
};
export type Packed = {
    layers: Uint8Array | Float32Array;
    width: number;
    height: number;
    depth: number;
    float: boolean;
    srgb: boolean;
    map: Float32Array;
    mapWidth: number;
};
import { RawTexture2DArray } from '@babylonjs/core';
import { RawTexture } from '@babylonjs/core';
import { NodeMaterialBlock } from '@babylonjs/core';
