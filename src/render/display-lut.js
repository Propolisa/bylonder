// Blender's display transform of a scene (its view transform, look, curves and display) as lattices the module
// evaluates with Blender's own OpenColorIO processor (image-api.cc display_lut), made again when the scene's view or
// display settings change: one log shaped, which a rendered view's display post-process samples (display-transform.js),
// and one for Babylon's color grading, which views drawing their image processing in their materials sample after its
// exposure and pow(1/2.2) encoding (its exposure scaled by 1 / range).
import { Constants, RawTexture3D } from '@babylonjs/core';
import { halfFloats } from '../blenkernel/colorband.js';
import { dnaGet, dnaProperty } from '../makesrna/dna-struct.js';
import { colorManagementFiles } from '../imbuf/colormanagement.js';

// Sizes that keep the log lattice within an 8-bit step of Blender's processor and the color grading one within a few
// (tests/display-lut-wasm.test.js); the log shaper spans STOPS below the view's white.
export const LOG_SIZE = 65, GRADING_SIZE = 65, STOPS = 18;
const VIEW = ['view_transform', 'look'], DISPLAY = ['display_device'];

function lattice(scene, rgba, size) {
  const texture = new RawTexture3D(halfFloats(rgba), size, size, size, Constants.TEXTUREFORMAT_RGBA, scene, false, false,
    Constants.TEXTURE_BILINEAR_SAMPLINGMODE, Constants.TEXTURETYPE_HALF_FLOAT);
  texture.wrapU = texture.wrapV = texture.wrapR = Constants.TEXTURE_CLAMP_ADDRESSMODE;
  return texture;
}

// The scene's lattices of `blender` (bmesh-wasm.js BlenderMain): { log: { texture, range }, grading: { texture, range } },
// or null until Blender's color management files are fetched, which the first call starts (its config reads its LUTs
// from them).
export function createDisplayLut(scene, blender) {
  let ready = null, key = '', current = null;
  const settingsKey = () => {
    const view = blender.scene + dnaProperty('Scene', 'view_settings').offset, display = blender.scene + dnaProperty('Scene', 'display_settings').offset;
    return [...VIEW.map((name) => dnaGet('ColorManagedViewSettings', view, name)), ...DISPLAY.map((name) => dnaGet('ColorManagedDisplaySettings', display, name))].join('|');
  };
  const make = (size, stops) => {
    const made = blender.displayLut(size, stops);
    return made && { texture: lattice(scene, made.rgba, size), range: made.range };
  };
  return () => {
    if (!blender.scene) return null;
    ready ??= colorManagementFiles().then(() => { ready = true; });
    if (ready !== true) return null;
    const now = settingsKey();
    if (now === key) return current;
    key = now;
    if (current) { current.log.texture.dispose(); current.grading.texture.dispose(); }
    const log = make(LOG_SIZE, STOPS), grading = log && make(GRADING_SIZE, 0);
    current = log && grading ? { log, grading } : null;
    return current;
  };
}
