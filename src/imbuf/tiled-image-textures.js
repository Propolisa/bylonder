// A UDIM image (an Image of source TILED) as Blender's image_gpu.cc gives it to its shaders: its tiles in the layers of
// one 2D array texture and a tile map that node_tex_tile_linear and node_tex_tile_cubic read through tiled_image_lookup
// (gpu_shader_tiled_image_lookup_lib.glsl). The map is one texel per tile number from 1001, two rows: row 0 holds the
// tile's layer (-1 for none, which draws pink as Blender's), row 1 its offset and scale in that layer. Each tile fills
// its layer from the corner, so tiles of different sizes share it. Byte tiles in sRGB stay sRGB bytes in an sRGB
// texture, which decodes as it samples; data and linear tiles stay plain bytes; float tiles stay float.
import { Constants, RawTexture, RawTexture2DArray, Texture } from '@babylonjs/core';
import { blenderModule } from '../bmesh/bmesh-wasm.js';
import { pointerOf } from '../python/bpy_rna.js';

const { exports: x } = blenderModule;
// image-api.cc ImageBufferKind.
const SRGB = 0;
// The largest tile a layer holds; larger tiles are halved until they fit.
export const MAX_TILE = 2048;
const FIRST = 1001;

// A tile's buffer (image-api.cc image_tile_buffer), copied out of the module's memory; null when it has none.
function tileBuffer(pointer, number) {
  const p = x.image_tile_buffer(pointer, number) >>> 0;
  if (!p) return null;
  const [width, height, bytes, floats, byteKind] = new Int32Array(x.memory.buffer, p >>> 0, 6);
  const float = floats !== 0;
  const pixels = float ? new Float32Array(x.memory.buffer, floats >>> 0, width * height * 4).slice() : new Uint8Array(x.memory.buffer, bytes >>> 0, width * height * 4).slice();
  return { number, width, height, float, srgb: !float && byteKind === SRGB, pixels };
}

// A buffer halved (a 2x2 box) until neither side exceeds `max`.
function fit(tile, max) {
  let { width, height, pixels } = tile;
  while (width > max || height > max) {
    const w = Math.max(1, width >> 1), h = Math.max(1, height >> 1), out = new pixels.constructor(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 4; c++) {
      const at = (sy, sx) => pixels[((Math.min(sy, height - 1)) * width + Math.min(sx, width - 1)) * 4 + c];
      out[(y * w + x) * 4 + c] = (at(2 * y, 2 * x) + at(2 * y, 2 * x + 1) + at(2 * y + 1, 2 * x) + at(2 * y + 1, 2 * x + 1)) / 4;
    }
    [width, height, pixels] = [w, h, out];
  }
  return { ...tile, width, height, pixels };
}

// The tiles packed as layers, and the map: { layers, width, height, float, srgb, map, mapWidth }.
export function tileLayers(imageStruct, max = MAX_TILE) {
  const pointer = pointerOf(imageStruct)[2];
  const tiles = [...imageStruct.tiles].map((t) => tileBuffer(pointer, t.number)).filter(Boolean).map((t) => fit(t, max));
  if (!tiles.length) return null;
  const width = Math.max(...tiles.map((t) => t.width)), height = Math.max(...tiles.map((t) => t.height));
  const float = tiles.some((t) => t.float), srgb = !float && tiles[0].srgb;
  const layers = new (float ? Float32Array : Uint8Array)(width * height * 4 * tiles.length);
  tiles.forEach((tile, layer) => {
    const pixels = float && !tile.float ? Float32Array.from(tile.pixels, (v) => v / 255) : tile.pixels;
    for (let y = 0; y < tile.height; y++) layers.set(pixels.subarray(y * tile.width * 4, (y + 1) * tile.width * 4), ((layer * height + y) * width) * 4);
  });
  const mapWidth = Math.max(...tiles.map((t) => t.number)) - FIRST + 1, map = new Float32Array(mapWidth * 2 * 4).fill(-1);
  tiles.forEach((tile, layer) => {
    const i = tile.number - FIRST;
    map.set([layer, 0, 0, 0], i * 4);
    map.set([0, 0, tile.width / width, tile.height / height], (mapWidth + i) * 4);
  });
  return { layers, width, height, depth: tiles.length, float, srgb, map, mapWidth };
}

// An sRGB 2D array texture: Babylon's raw 2D arrays have no sRGB flag, so the storage is given an sRGB format through
// the engine's own context (SRGB8_ALPHA8 on WebGL 2, rgba8unorm-srgb on WebGPU) and refilled after a lost context.
function srgbArray(scene, { layers, width, height, depth }, sampling) {
  const engine = scene.getEngine(), texture = new RawTexture2DArray(null, width, height, depth, Constants.TEXTUREFORMAT_RGBA, scene, true, false, sampling);
  const internal = texture.getInternalTexture();
  const fill = () => {
    if (engine.isWebGPU) {
      // Babylon's private flag, which its WebGPU texture manager reads for the format (tests/udim-wasm.test.js guards it).
      internal._useSRGBBuffer = true;
      engine._textureHelper.createGPUTextureForInternalTexture(internal, width, height, depth, 0);
      engine.updateRawTexture2DArray(internal, layers, Constants.TEXTUREFORMAT_RGBA, false, null, Constants.TEXTURETYPE_UNSIGNED_BYTE);
      return;
    }
    const gl = engine._gl;
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

// The array and map textures of a tiled image in a scene, made once per image, scene and sampling.
const made = new Map();
export function tiledImageTextures(imageStruct, scene, { sampling = Texture.TRILINEAR_SAMPLINGMODE, max = MAX_TILE } = {}) {
  const key = `${imageStruct.session_uid} ${scene.uid} ${sampling} ${max}`;
  if (made.has(key)) return made.get(key);
  const packed = tileLayers(imageStruct, max);
  if (!packed) return null;
  const array = packed.srgb ? srgbArray(scene, packed, sampling)
    : new RawTexture2DArray(packed.layers, packed.width, packed.height, packed.depth, Constants.TEXTUREFORMAT_RGBA, scene, true, false, sampling,
      packed.float ? Constants.TEXTURETYPE_FLOAT : Constants.TEXTURETYPE_UNSIGNED_BYTE);
  const map = new RawTexture(packed.map, packed.mapWidth, 2, Constants.TEXTUREFORMAT_RGBA, scene, false, false, Texture.NEAREST_SAMPLINGMODE, Constants.TEXTURETYPE_FLOAT);
  [array.name, map.name] = [imageStruct.name, `${imageStruct.name} tiles`];
  const textures = { array, map };
  made.set(key, textures);
  array.onDisposeObservable.addOnce(() => { made.delete(key); map.dispose(); });
  return textures;
}
