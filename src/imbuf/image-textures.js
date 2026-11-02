// Main's Images drawn by Babylon, as Blender's image_gpu.cc gives its engines GPU textures: one GPU texture per Image,
// filled from its buffer (image-api.cc image_buffer) and updated from Blender's partial updates of it (a paint stroke's
// changed regions only), with its mipmaps made again once it stops changing. Each user samples it through a Texture of
// its own wrapping (an Image Texture node's extension), all sharing the one GPU texture.
import { Constants, Texture } from '@babylonjs/core';
import { blenderModule } from '../bmesh/bmesh-wasm.js';
import { blendData, contextStruct, pointerOf } from '../python/bpy_rna.js';

const { exports: x, withArrays } = blenderModule;
// image-api.cc ImageBufferKind.
const SRGB = 0, DATA = 2;
// Regions collected per update before a whole upload is cheaper.
const MAX_REGIONS = 64;

// The image's buffer as it is drawn: its float buffer when it has one (scene linear, premultiplied as Blender keeps
// it, which its samplers handle: imagePremultiplied), else its byte buffer (sRGB unless its color space is data or linear); null while it has none.
function imageBuffer(image) {
  const p = x.image_buffer(image, 0) >>> 0;
  if (!p) return null;
  const [width, height, bytes, floats, byteKind, floatKind] = new Int32Array(x.memory.buffer, p, 6);
  const float = floats !== 0;
  return { width, height, float, srgb: !float && byteKind === SRGB, data: (float ? floatKind : byteKind) === DATA,
    pixels: float ? new Float32Array(x.memory.buffer, floats >>> 0, width * height * 4) : new Uint8Array(x.memory.buffer, bytes >>> 0, width * height * 4) };
}

// A region of the buffer uploaded from it in place: WebGL2's unpack row length and skips pick its rows and columns.
function uploadRegion(engine, texture, buffer, [xmin, ymin, xmax, ymax]) {
  const gl = engine._gl, unpack = (rowLength, skipPixels, skipRows) => {
    gl?.pixelStorei(gl.UNPACK_ROW_LENGTH, rowLength);
    gl?.pixelStorei(gl.UNPACK_SKIP_PIXELS, skipPixels);
    gl?.pixelStorei(gl.UNPACK_SKIP_ROWS, skipRows);
  };
  unpack(buffer.width, xmin, ymin);
  try {
    engine.updateTextureData(texture, buffer.pixels, xmin, ymin, xmax - xmin, ymax - ymin);
  } finally {
    unpack(0, 0, 0);
  }
}

// image: { session_uid, user (its PartialUpdateUser), internal (Babylon's GPU texture), stale (mipmaps behind) }.
const images = new Map();
let woken = () => {};

function upload(engine, image, pointer) {
  const buffer = imageBuffer(pointer);
  if (!buffer) return false;
  // The texture has every change so far: the next collect gives only those after it (a new user's first is all of it).
  x.image_partial_update_collect(pointer, image.user, 0, 0);
  const { width, height, float, srgb } = buffer, internal = image.internal;
  if (internal && internal.width === width && internal.height === height && internal.type === (float ? Constants.TEXTURETYPE_FLOAT : Constants.TEXTURETYPE_UNSIGNED_BYTE) && internal._useSRGBBuffer === srgb) {
    engine.updateRawTexture(internal, buffer.pixels, Constants.TEXTUREFORMAT_RGBA, false, null, internal.type, srgb);
    engine.generateMipmaps?.(internal);
    return true;
  }
  const created = engine.createRawTexture(buffer.pixels, width, height, Constants.TEXTUREFORMAT_RGBA, true, false,
    Texture.TRILINEAR_SAMPLINGMODE, null, float ? Constants.TEXTURETYPE_FLOAT : Constants.TEXTURETYPE_UNSIGNED_BYTE, 0, srgb);
  if (internal) { internal._swapAndDie(created); } else image.internal = created;
  return true;
}

// Blender's changes to an image since its texture last followed them: all of it, or its changed regions.
function follow(engine, image, pointer) {
  if (!image.internal) return upload(engine, image, pointer);
  const count = withArrays([new Int32Array(MAX_REGIONS * 4)], ([p]) => {
    const n = x.image_partial_update_collect(pointer, image.user, p, MAX_REGIONS);
    image.regions = n > 0 ? Array.from({ length: n }, (_, i) => Array.from(new Int32Array(x.memory.buffer, p + i * 16, 4))) : [];
    return n;
  });
  if (count < 0) return upload(engine, image, pointer);
  if (count === 0) {
    if (image.stale) { engine.generateMipmaps?.(image.internal); image.stale = false; return true; }
    return false;
  }
  const buffer = imageBuffer(pointer);
  if (!buffer || buffer.width !== image.internal.width || buffer.height !== image.internal.height) return upload(engine, image, pointer);
  for (const r of image.regions) {
    const clipped = [Math.max(0, r[0]), Math.max(0, r[1]), Math.min(buffer.width, r[2]), Math.min(buffer.height, r[3])];
    if (clipped[2] > clipped[0] && clipped[3] > clipped[1]) uploadRegion(engine, image.internal, buffer, clipped);
  }
  image.stale = true;
  return true;
}

// Each drawn image follows Main once per frame; an image Main no longer holds (deleted, or an undo step without it)
// lets its texture go. Images are found by session_uid, which undo keeps, as their addresses can change.
export function updateImageTextures(engine) {
  if (!images.size) return;
  const held = new Map([...blendData().images].map((image) => [image.session_uid, pointerOf(image)[2]]));
  let changed = false;
  for (const [uid, image] of images) {
    const pointer = held.get(uid);
    if (!pointer) { forget(uid, image); changed = true; continue; }
    if (image.pointer !== pointer) {
      if (image.user) x.image_partial_update_free(image.user);
      Object.assign(image, { pointer, user: x.image_partial_update_create(pointer) >>> 0 });
      changed = upload(engine, image, pointer) || changed;
      continue;
    }
    changed = follow(engine, image, pointer) || changed;
  }
  if (changed) woken();
}

function forget(uid, image) {
  x.image_partial_update_free(image.user);
  for (const texture of image.textures.values()) texture.dispose();
  image.internal?.dispose();
  images.delete(uid);
}

// Image Texture's extension (node_shader_tex_image.cc) as Babylon's addressing; CLIP is clamp to a border Babylon's
// samplers lack, so it clamps to the edge (listed in the feature's limits).
const ADDRESS = { REPEAT: Texture.WRAP_ADDRESSMODE, EXTEND: Texture.CLAMP_ADDRESSMODE, CLIP: Texture.CLAMP_ADDRESSMODE, MIRROR: Texture.MIRROR_ADDRESSMODE };
// Interpolation as Babylon's sampling of the one texture (filtering belongs to the GPU texture, so its last user's
// interpolation applies to all of them); Cubic and Smart sample linearly, as EEVEE's Smart does when not magnifying.
const SAMPLING = { Linear: Texture.TRILINEAR_SAMPLINGMODE, Closest: Texture.NEAREST_NEAREST_MIPLINEAR, Cubic: Texture.TRILINEAR_SAMPLINGMODE, Smart: Texture.TRILINEAR_SAMPLINGMODE };

// Preferences > Viewport > Textures > Anisotropic Filtering, which Blender's samplers use (GPU_samplers_update).
const preferredAnisotropy = () => Math.max(1, Number(contextStruct().preferences.system.anisotropic_filter.replace('FILTER_', '')));

// The Babylon Texture showing an Image of Main's (its RNA struct) in a scene, sampled as given (one per scene and
// sampling); null while the image has no buffer. Its color space follows the buffer: sRGB bytes decode in the sampler, so shaders read linear values.
export function imageTexture(imageStruct, scene, { interpolation = 'Linear', extension = 'REPEAT' } = {}) {
  const uid = imageStruct.session_uid, pointer = pointerOf(imageStruct)[2];
  let image = images.get(uid);
  if (!image) {
    image = { pointer, user: x.image_partial_update_create(pointer) >>> 0, internal: null, stale: false, textures: new Map() };
    images.set(uid, image);
    upload(scene.getEngine(), image, pointer);
  }
  if (!image.internal) return null;
  const key = `${scene.uid} ${interpolation} ${extension}`;
  if (image.textures.has(key)) return image.textures.get(key);
  const texture = new Texture(null, scene, { noMipmap: false, invertY: false, samplingMode: SAMPLING[interpolation] ?? SAMPLING.Linear });
  texture._texture = image.internal;
  image.internal.incrementReferences();
  texture.wrapU = texture.wrapV = ADDRESS[extension] ?? ADDRESS.REPEAT;
  texture.name = imageStruct.name;
  texture.metadata = { interpolation };
  sampleAsBlender(texture);
  image.textures.set(key, texture);
  texture.onDisposeObservable.addOnce(() => image.textures.delete(key));
  return texture;
}

// The Babylon Textures an Image of Main's is drawn with, and sampled as Blender samples it (an image's runtime,
// runtimes/image.js, samples them with Babylon's settings instead).
export const imageTextures = (imageStruct) => [...(images.get(imageStruct.session_uid)?.textures.values() ?? [])];
export function sampleAsBlender(texture) {
  sample(texture, preferredAnisotropy(), SAMPLING[texture.metadata.interpolation] ?? SAMPLING.Linear);
}
export function sample(texture, anisotropy, mode) {
  texture.anisotropicFilteringLevel = anisotropy;
  if (texture.samplingMode !== mode) texture.updateSamplingMode(mode);
}

// Whether an image's texture holds premultiplied alpha (BKE_image_has_gpu_texture_premultiplied_alpha): a float buffer's,
// uploaded as Blender keeps it.
export const imagePremultiplied = (texture) => texture?.getInternalTexture()?.type === Constants.TEXTURETYPE_FLOAT;

// What redraws the views when an image's texture changed.
export function onImageTexturesChanged(fn) { woken = fn; }
