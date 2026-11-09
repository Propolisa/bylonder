// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// A rendered view's display transform in an exported page, as Bylonder's views draw it: the scene renders in scene
// linear (its materials leave image processing to a post process), effects and the compositor work on that, and the
// camera's last post process displays it: exposure, then the view transform and look (a lattice of Blender's display
// processor, made at export, on a log shaped input), then the view gamma. Without a lattice the view transform is
// Standard's sRGB encoding.
import { Constants, Effect, PostProcess, RawTexture3D } from '@babylonjs/core';

/** @typedef {import('@babylonjs/core').Camera} Camera */

/**
 * The display settings: exposure as a factor, the gamma's exponent, and the lattice: its size, the stops below the
 * view's white its log input spans, that white (`range`), and its texels (RGBA half floats).
 * @typedef {object} Display
 * @property {number} exposure
 * @property {number} exponent
 * @property {{ size: number, stops: number, range: number, texels: Uint16Array } | null} lattice
 */

/**
 * The display transform's fragment shader for a lattice of `size` spanning `stops`; defining SRGB_ONLY leaves the
 * lattice out.
 * @param {number} size
 * @param {number} stops
 */
export const displayTransformShader = (size, stops) => `precision highp float;
varying vec2 vUV;
uniform sampler2D textureSampler;
#ifndef SRGB_ONLY
precision highp sampler3D;
uniform sampler3D lattice;
#endif
uniform float exposure;
uniform float range;
uniform float exponent;
uniform float latticed;
// A view's own background (a display color, alpha 1) where its film's coverage leaves it, or none (alpha 0).
uniform vec4 background;
vec3 srgb(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
void main(void) {
  vec4 color = texture2D(textureSampler, vUV);
  float coverage = background.a > 0.5 ? clamp(color.a, 0.0, 1.0) : 1.0;
  vec3 linear = max(color.rgb / max(coverage, 1e-4) * exposure, 0.0), display;
  display = srgb(clamp(linear, 0.0, 1.0));
#ifndef SRGB_ONLY
  if (latticed > 0.5) {
    vec3 u = clamp(log2(max(linear / range, 1e-30)) / ${stops.toFixed(1)} + 1.0, 0.0, 1.0);
    display = texture(lattice, u * ${((size - 1) / size).toFixed(8)} + ${(0.5 / size).toFixed(8)}).rgb;
  }
#endif
  display = pow(max(display, 0.0), vec3(exponent));
  gl_FragColor = background.a > 0.5 ? vec4(mix(background.rgb, display, coverage), 1.0) : vec4(display, 1.0);
}`;
export const DISPLAY_UNIFORMS = ['exposure', 'range', 'exponent', 'latticed', 'background'];

/**
 * The camera's display transform, its last post process, with the scene's materials drawing in scene linear.
 * @param {Camera} camera
 * @param {Display} display
 */
export function viewTransform(camera, { exposure, exponent, lattice }) {
  const scene = camera.getScene(), name = `bylonderDisplay${lattice?.size ?? 0}_${lattice?.stops ?? 0}`;
  Effect.ShadersStore[`${name}FragmentShader`] ??= displayTransformShader(lattice?.size ?? 2, lattice?.stops ?? 1);
  const texture = lattice && new RawTexture3D(lattice.texels, lattice.size, lattice.size, lattice.size, Constants.TEXTUREFORMAT_RGBA, scene, false, false,
    Constants.TEXTURE_BILINEAR_SAMPLINGMODE, Constants.TEXTURETYPE_HALF_FLOAT);
  if (texture) texture.wrapU = texture.wrapV = texture.wrapR = Constants.TEXTURE_CLAMP_ADDRESSMODE;
  Object.assign(scene.imageProcessingConfiguration, { applyByPostProcess: true, toneMappingEnabled: false, contrast: 1, exposure: 1 });
  const post = new PostProcess('Display Transform', name, DISPLAY_UNIFORMS, texture ? ['lattice'] : [], 1, camera, Constants.TEXTURE_BILINEAR_SAMPLINGMODE,
    undefined, false, texture ? null : '#define SRGB_ONLY', Constants.TEXTURETYPE_HALF_FLOAT);
  post.onApply = (effect) => {
    effect.setFloat4('background', 0, 0, 0, 0);
    effect.setFloat('exposure', exposure);
    effect.setFloat('exponent', exponent);
    effect.setFloat('latticed', lattice ? 1 : 0);
    effect.setFloat('range', lattice?.range ?? 1);
    if (texture) effect.setTexture('lattice', texture);
  };
  // Last: a pipeline that builds its post processes again appends them after it.
  const last = scene.onBeforeCameraRenderObservable.add((rendering) => {
    if (rendering !== camera || camera._postProcesses.filter(Boolean).at(-1) === post) return;
    camera.detachPostProcess(post);
    camera.attachPostProcess(post);
  });
  post.onDisposeObservable.add(() => { scene.onBeforeCameraRenderObservable.remove(last); texture?.dispose(); });
  return post;
}
