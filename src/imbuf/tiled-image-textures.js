// A UDIM image (an Image of source TILED) as Blender's image_gpu.cc gives it to its shaders: its tiles' buffers
// (image-api.cc image_tile_buffer) packed as the layers of one 2D array texture with the tile map Blender's
// node_tex_tile_linear and node_tex_tile_cubic read (runtime/tiled-images.js, which an exported page uses too).
import { Texture } from '@babylonjs/core';
import { blenderModule } from '../bmesh/bmesh-wasm.js';
import { pointerOf } from '../python/bpy_rna.js';
import { MAX_TILE, packTiles, tileTextures } from '../io_scene_babylon/runtime/tiled-images.js';

const { exports: x } = blenderModule;
// image-api.cc ImageBufferKind.
const SRGB = 0;

// A tile's buffer, copied out of the module's memory; null when it has none.
function tileBuffer(pointer, number) {
  const p = x.image_tile_buffer(pointer, number) >>> 0;
  if (!p) return null;
  const [width, height, bytes, floats, byteKind] = new Int32Array(x.memory.buffer, p >>> 0, 6);
  const float = floats !== 0;
  const pixels = float ? new Float32Array(x.memory.buffer, floats >>> 0, width * height * 4).slice() : new Uint8Array(x.memory.buffer, bytes >>> 0, width * height * 4).slice();
  return { number, width, height, float, srgb: !float && byteKind === SRGB, pixels };
}

// An image's tiles as Blender holds them, by tile number.
export const imageTiles = (imageStruct) => {
  const pointer = pointerOf(imageStruct)[2];
  return [...imageStruct.tiles].map((t) => tileBuffer(pointer, t.number)).filter(Boolean);
};

// The image's tiles packed as array layers with their map.
export const tileLayers = (imageStruct, max = MAX_TILE) => packTiles(imageTiles(imageStruct), max);

// The array and map textures of a tiled image in a scene, made once per image, scene and sampling.
const made = new Map();
export function tiledImageTextures(imageStruct, scene, { sampling = Texture.TRILINEAR_SAMPLINGMODE, max = MAX_TILE } = {}) {
  const key = `${imageStruct.session_uid} ${scene.uid} ${sampling} ${max}`;
  if (made.has(key)) return made.get(key);
  const packed = tileLayers(imageStruct, max);
  if (!packed) return null;
  const textures = tileTextures(scene, packed, imageStruct.name, sampling);
  made.set(key, textures);
  textures.array.onDisposeObservable.addOnce(() => made.delete(key));
  return textures;
}
