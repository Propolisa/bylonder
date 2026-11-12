// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// UDIM images (Blender's tiled images) as Blender's shaders sample them: the tiles as the layers of one 2D array
// texture and a tile map that Blender's tiled_image_lookup reads (gpu_shader_tiled_image_lookup_lib.glsl). The map is
// one texel per tile number from 1001, two rows: row 0 the tile's layer (-1 for none), row 1 its offset and scale in
// that layer. Each tile fills its layer from the corner, so tiles of different sizes share it. Byte tiles in sRGB
// stay sRGB bytes in an sRGB texture, which decodes as it samples; data tiles stay plain bytes; float tiles stay float.
// The app packs Blender's tile buffers with this; an exported page packs its tile files the same way.
import { Constants, NodeMaterialBlock, NodeMaterialBlockConnectionPointTypes, NodeMaterialBlockTargets, RawTexture, RawTexture2DArray, RegisterClass, Texture } from '@babylonjs/core';

/** @typedef {{ number: number, width: number, height: number, float: boolean, srgb: boolean, pixels: Uint8Array | Float32Array }} Tile rows bottom first */
/** @typedef {{ layers: Uint8Array | Float32Array, width: number, height: number, depth: number, float: boolean, srgb: boolean, map: Float32Array, mapWidth: number }} Packed */

/** The largest tile a layer holds; larger tiles are halved until they fit. */
export const MAX_TILE = 2048;
const FIRST = 1001;

/** A tile halved (a 2x2 box) until neither side exceeds `max`. @param {Tile} tile @param {number} max @returns {Tile} */
function fit(tile, max) {
  let { width, height, pixels } = tile;
  while (width > max || height > max) {
    const w = Math.max(1, width >> 1), h = Math.max(1, height >> 1), out = new /** @type {any} */ (pixels.constructor)(w * h * 4);
    const at = (/** @type {number} */ y, /** @type {number} */ x, /** @type {number} */ c) => pixels[(Math.min(y, height - 1) * width + Math.min(x, width - 1)) * 4 + c];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 4; c++) {
      out[(y * w + x) * 4 + c] = (at(2 * y, 2 * x, c) + at(2 * y, 2 * x + 1, c) + at(2 * y + 1, 2 * x, c) + at(2 * y + 1, 2 * x + 1, c)) / 4;
    }
    [width, height, pixels] = [w, h, out];
  }
  return { ...tile, width, height, pixels };
}

/** Tiles packed as layers, with their map; null for none. @param {Tile[]} given @param {number} [max] @returns {Packed | null} */
export function packTiles(given, max = MAX_TILE) {
  const tiles = given.map((t) => fit(t, max));
  if (!tiles.length) return null;
  const width = Math.max(...tiles.map((t) => t.width)), height = Math.max(...tiles.map((t) => t.height));
  const float = tiles.some((t) => t.float), srgb = !float && tiles[0].srgb;
  const layers = float ? new Float32Array(width * height * 4 * tiles.length) : new Uint8Array(width * height * 4 * tiles.length);
  tiles.forEach((tile, layer) => {
    const pixels = float && !tile.float ? Float32Array.from(tile.pixels, (v) => v / 255) : tile.pixels;
    for (let y = 0; y < tile.height; y++) layers.set(pixels.subarray(y * tile.width * 4, (y + 1) * tile.width * 4), (layer * height + y) * width * 4);
  });
  const mapWidth = Math.max(...tiles.map((t) => t.number)) - FIRST + 1, map = new Float32Array(mapWidth * 2 * 4).fill(-1);
  tiles.forEach((tile, layer) => {
    map.set([layer, 0, 0, 0], (tile.number - FIRST) * 4);
    map.set([0, 0, tile.width / width, tile.height / height], (mapWidth + tile.number - FIRST) * 4);
  });
  return { layers, width, height, depth: tiles.length, float, srgb, map, mapWidth };
}

/**
 * An sRGB 2D array texture. Babylon's raw 2D arrays have no sRGB option, so the storage takes an sRGB format through
 * the engine's own context (SRGB8_ALPHA8 on WebGL 2, rgba8unorm-srgb on WebGPU), filled again after a lost context.
 * @param {import('@babylonjs/core').Scene} scene @param {Packed} packed @param {number} sampling
 */
function srgbArray(scene, { layers, width, height, depth }, sampling) {
  const engine = /** @type {any} */ (scene.getEngine()), texture = new RawTexture2DArray(null, width, height, depth, Constants.TEXTUREFORMAT_RGBA, scene, true, false, sampling);
  const internal = /** @type {any} */ (texture.getInternalTexture());
  const fill = () => {
    if (engine.isWebGPU) {
      // Babylon's private flag, which its WebGPU texture manager reads for the format (tests/udim-wasm.test.js guards it).
      internal._useSRGBBuffer = true;
      engine._textureHelper.createGPUTextureForInternalTexture(internal, width, height, depth, 0);
      engine.updateRawTexture2DArray(internal, layers, Constants.TEXTUREFORMAT_RGBA, false, null, Constants.TEXTURETYPE_UNSIGNED_BYTE);
      return;
    }
    const gl = engine._gl;
    if (!gl) return;
    engine._bindTextureDirectly(gl.TEXTURE_2D_ARRAY, internal, true);
    gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.SRGB8_ALPHA8, width, height, depth, 0, gl.RGBA, gl.UNSIGNED_BYTE, layers);
    gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
    engine._bindTextureDirectly(gl.TEXTURE_2D_ARRAY, null);
    internal.isReady = true;
  };
  fill();
  const restored = engine.onContextRestoredObservable?.add(fill);
  texture.onDisposeObservable.addOnce(() => engine.onContextRestoredObservable?.remove(restored));
  return texture;
}

/**
 * The array and map textures of packed tiles in a scene.
 * @param {import('@babylonjs/core').Scene} scene @param {Packed} packed @param {string} name
 * @param {number} [sampling]
 */
export function tileTextures(scene, packed, name, sampling = Texture.TRILINEAR_SAMPLINGMODE) {
  const array = packed.srgb ? srgbArray(scene, packed, sampling)
    : new RawTexture2DArray(packed.layers, packed.width, packed.height, packed.depth, Constants.TEXTUREFORMAT_RGBA, scene, true, false, sampling,
      packed.float ? Constants.TEXTURETYPE_FLOAT : Constants.TEXTURETYPE_UNSIGNED_BYTE);
  const map = new RawTexture(packed.map, packed.mapWidth, 2, Constants.TEXTUREFORMAT_RGBA, scene, false, false, Texture.NEAREST_SAMPLINGMODE, Constants.TEXTURETYPE_FLOAT);
  [array.name, map.name] = [name, `${name} tiles`];
  array.onDisposeObservable.addOnce(() => map.dispose());
  return { array, map };
}

/**
 * Tile files as tiles, decoded by the browser: bytes, rows bottom first as Blender's buffers.
 * @param {{ number: number, url: string, srgb: boolean }[]} files
 * @returns {Promise<Tile[]>}
 */
export async function decodeTiles(files) {
  return Promise.all(files.map(async ({ number, url, srgb }) => {
    const bitmap = await createImageBitmap(await (await fetch(url)).blob(), { imageOrientation: 'flipY', premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height), context = /** @type {OffscreenCanvasRenderingContext2D} */ (canvas.getContext('2d'));
    context.drawImage(bitmap, 0, 0);
    const pixels = new Uint8Array(context.getImageData(0, 0, bitmap.width, bitmap.height).data.buffer);
    return { number, width: bitmap.width, height: bitmap.height, float: false, srgb, pixels };
  }));
}

/** @type {WeakMap<import('@babylonjs/core').Scene, Map<string, Promise<ReturnType<typeof tileTextures> | null>>>} */
const loaded = new WeakMap();
/**
 * A UDIM image's textures in a page, from its tile files, made once per scene and image.
 * @param {import('@babylonjs/core').Scene} scene @param {string} image
 * @param {{ number: number, url: string, srgb: boolean }[]} files
 */
function pageTextures(scene, image, files) {
  const byImage = loaded.get(scene) ?? new Map();
  loaded.set(scene, byImage);
  if (!byImage.has(image)) {
    byImage.set(image, typeof createImageBitmap === 'function' && files.length
      ? decodeTiles(files).then((tiles) => { const packed = packTiles(tiles); return packed && tileTextures(scene, packed, image); })
      : Promise.resolve(null));
  }
  return /** @type {Promise<ReturnType<typeof tileTextures> | null>} */ (byImage.get(image));
}

export const TILE_BLOCK = 'TileBlock';
/**
 * A UDIM image's sampler in a node material: its tiles' array (`part` 'array') or its tile map ('map'), declared as a
 * global named `samplerName`, which the material's node code reads. Its `ready` output orders it before that code.
 * The array part carries the tiles' files (`tiles`), which the page decodes; the map part finds them by `image`.
 */
export class TileBlock extends NodeMaterialBlock {
  /** @param {string} name */
  constructor(name) {
    super(name, NodeMaterialBlockTargets.Fragment);
    this.registerOutput('ready', NodeMaterialBlockConnectionPointTypes.Float);
    this.samplerName = 'bl_tiles';
    /** @type {'array' | 'map'} */
    this.part = 'array';
    this.image = '';
    /** @type {{ number: number, url?: string, name?: string, srgb: boolean }[]} */
    this.tiles = [];
    /** @type {import('@babylonjs/core').BaseTexture | null} */
    this.texture = null;
  }
  getClassName() { return TILE_BLOCK; }
  get ready() { return this._outputs[0]; }
  /** @param {any} state */
  _buildBlock(state) {
    super._buildBlock(state);
    if (this.part === 'array') state._emit2DArraySampler(this.samplerName);
    else state._emit2DSampler(this.samplerName, '', false, undefined, false, 'highp');
    state.compilationString += `${state._declareOutput(this.ready)} = 1.0;
`;
    return this;
  }
  /** @param {import('@babylonjs/core').Effect} effect */
  bind(effect) {
    if (this.texture) effect.setTexture(this.samplerName, this.texture);
  }
  serialize() {
    return { ...super.serialize(), samplerName: this.samplerName, part: this.part, image: this.image, tiles: this.tiles };
  }
  /** @param {any} serialized @param {import('@babylonjs/core').Scene} scene @param {string} rootUrl */
  _deserialize(serialized, scene, rootUrl) {
    super._deserialize(serialized, scene, rootUrl);
    Object.assign(this, { samplerName: serialized.samplerName, part: serialized.part, image: serialized.image, tiles: serialized.tiles ?? [] });
    const files = this.tiles.map((t) => ({ number: t.number, srgb: t.srgb, url: rootUrl + (t.url ?? t.name ?? '') }));
    pageTextures(scene, this.image, files).then((textures) => { if (textures) this.texture = textures[this.part]; });
  }
}
RegisterClass(`BABYLON.${TILE_BLOCK}`, TileBlock);
