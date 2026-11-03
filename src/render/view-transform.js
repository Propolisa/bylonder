// Blender's view transforms Standard, AgX and Filmic as a display pass: the scene linear image, times the exposure,
// through the sRGB curve (Standard) or a 3D LUT of Blender's own OCIO processor for the view
// (tools/blender-reference/view-transform-luts.py writes them, sampled on log2 axes), then Blender's display gamma. The last post-process of a rendered view's camera, in place of Babylon's
// image processing (render-babylon.js turns that off for these views).
import { Constants, PostProcess, RawTexture3D, ShaderStore, Texture } from '@babylonjs/core';

// As view-transform-luts.py samples them.
const SIZE = 33, LOG_MIN = -12.5, LOG_MAX = 12.5;
const LUTS = { AGX: new URL('./view-transforms/agx.bin', import.meta.url), FILMIC: new URL('./view-transforms/filmic.bin', import.meta.url) };
export const DISPLAY_PASS_VIEWS = ['STANDARD', ...Object.keys(LUTS)];

ShaderStore.ShadersStore.blenderViewTransformFragmentShader = `precision highp float;
precision highp sampler3D;
varying vec2 vUV;
uniform sampler2D textureSampler;
uniform sampler3D lut;
uniform float exposure;
uniform float gamma;
uniform float useLut;
// The sRGB display's curve, as Blender's config encodes it.
vec3 srgb(vec3 c) { c = clamp(c, 0.0, 1.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
void main(void) {
  vec3 linear = max(texture2D(textureSampler, vUV).rgb * exposure, vec3(0.0));
  if (useLut < 0.5) { gl_FragColor = vec4(pow(srgb(linear), vec3(1.0 / gamma)), 1.0); return; }
  vec3 u = clamp((log2(max(linear, vec3(exp2(${LOG_MIN.toFixed(1)})))) - ${LOG_MIN.toFixed(1)}) / ${(LOG_MAX - LOG_MIN).toFixed(1)}, 0.0, 1.0);
  vec3 display = texture(lut, u * ${((SIZE - 1) / SIZE).toFixed(8)} + ${(0.5 / SIZE).toFixed(8)}).rgb;
  gl_FragColor = vec4(pow(display, vec3(1.0 / gamma)), 1.0);
}`;

const textures = new Map();
async function lutTexture(scene, id) {
  const key = `${scene.uid} ${id}`;
  if (!textures.has(key)) textures.set(key, (async () => {
    const words = new Uint16Array(await (await fetch(LUTS[id])).arrayBuffer());
    const rgba = new Float32Array(SIZE ** 3 * 4);
    for (let i = 0; i < SIZE ** 3; i++) rgba.set([words[i * 3] / 65535, words[i * 3 + 1] / 65535, words[i * 3 + 2] / 65535, 1], i * 4);
    const texture = new RawTexture3D(rgba, SIZE, SIZE, SIZE, Constants.TEXTUREFORMAT_RGBA, scene, false, false, Texture.BILINEAR_SAMPLINGMODE, Constants.TEXTURETYPE_FLOAT);
    texture.wrapU = texture.wrapV = texture.wrapR = Texture.CLAMP_ADDRESSMODE;
    return texture;
  })());
  return textures.get(key);
}

// The pass on a camera; `settings()` gives { viewTransform, exposure, gamma } (render.js viewSettings).
export function createViewTransform(scene, camera, settings) {
  let lut = null, loading = null, empty = null;
  // Black until the view's LUT is loaded.
  const black = () => (empty ??= new RawTexture3D(new Float32Array(4), 1, 1, 1, Constants.TEXTUREFORMAT_RGBA, scene, false, false, Texture.NEAREST_SAMPLINGMODE, Constants.TEXTURETYPE_FLOAT));
  const pass = new PostProcess('__viewTransform', 'blenderViewTransform', ['exposure', 'gamma', 'useLut'], ['lut'], 1, camera, Constants.TEXTURE_NEAREST_SAMPLINGMODE, scene.getEngine());
  pass.onApply = (effect) => {
    const { viewTransform, exposure, gamma } = settings();
    const lutted = viewTransform in LUTS;
    effect.setFloat('useLut', lutted ? 1 : 0);
    if (lutted && lut?.id !== viewTransform && loading !== viewTransform) {
      loading = viewTransform;
      lutTexture(scene, viewTransform).then((texture) => { lut = { id: viewTransform, texture }; loading = null; });
    }
    effect.setTexture('lut', lut?.id === viewTransform ? lut.texture : black());
    effect.setFloat('exposure', 2 ** exposure);
    effect.setFloat('gamma', gamma ?? 1);
  };
  return { dispose: () => { pass.dispose(camera); empty?.dispose(); } };
}
