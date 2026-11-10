// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// Override of Babylon's texture parser (Texture.Parse): a texture serialized with an sRGB buffer (an sRGB image, as the app uploads it) loads into one, as Babylon's parser drops the flag and the page sampled sRGB bytes as linear; goes when Babylon's parser passes useSRGBBuffer.
import { Texture } from '@babylonjs/core';

const parse = Texture.Parse;
/**
 * @param {any} parsed @param {import('@babylonjs/core').Scene} scene @param {string} rootUrl
 * @returns {import('@babylonjs/core').Nullable<import('@babylonjs/core').BaseTexture>}
 */
export function parseTexture(parsed, scene, rootUrl) {
  if (!parsed?._useSRGBBuffer || parsed.base64String || !parsed.name || parsed.name.startsWith('data:')) return parse(parsed, scene, rootUrl);
  // Created unloaded, then loaded into an sRGB buffer from the URL the parser gave it before its properties overwrote it.
  const delayed = scene.useDelayedTextureLoading;
  scene.useDelayedTextureLoading = true;
  let texture;
  try { texture = /** @type {any} */ (parse(parsed, scene, rootUrl)); } finally { scene.useDelayedTextureLoading = delayed; }
  if (!texture || texture.getClassName() !== 'Texture') return texture;
  Object.assign(texture, { _useSRGBBuffer: true, url: parsed.name.indexOf('://') > 0 ? parsed.name : rootUrl + parsed.name });
  if (!delayed) texture.delayLoad();
  return texture;
}
Texture.Parse = parseTexture;
