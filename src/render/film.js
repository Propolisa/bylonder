// EEVEE's film (eevee_film.cc): a view's samples, each rendered with its own sub-pixel jitter, accumulated in scene
// linear with the Blackman-Harris filter's weights over a radius of 1.5 pixels, and their weighted average displayed.
// Two post-processes first in the camera's chain, before Babylon's pipeline: the film draws each sample's weighted
// colors and weights additively into the resolve's input, which keeps them from sample to sample, and the resolve
// divides; the display transform comes after, as EEVEE's does.
import { Camera, Constants, Matrix, PostProcess, ShaderStore } from '@babylonjs/core';
import { halton, jitterProjection } from './sampling.js';
import { setDitherOffset } from './dither.js';

// blender-port: DNA_scene_defaults.h filter_size: Blender's default filter width, in pixels.
export const FILTER_RADIUS = 1.5;

ShaderStore.ShadersStore.blenderFilmFragmentShader = `precision highp float;
varying vec2 vUV;
uniform sampler2D textureSampler;
uniform vec2 texelSize;
uniform vec2 jitter;
uniform float radius;
uniform float weightScale;
// blender-port: eevee_film_lib.glsl film_filter_weight: a Gaussian fitted to Blackman-Harris.
float film_filter_weight(float filter_radius, float sample_distance_sqr) {
  float r = sample_distance_sqr / (filter_radius * filter_radius);
  const float sigma = 0.284;
  const float fac = -0.5 / (sigma * sigma);
  return exp(fac * r);
}
void main(void) {
  vec4 sum = vec4(0.0);
  for (int y = -2; y <= 2; y++) {
    for (int x = -2; x <= 2; x++) {
      // A neighbor's sample lies at its pixel less the jitter the projection moved the image by.
      vec2 offset = vec2(float(x), float(y)) - jitter;
      float d2 = dot(offset, offset);
      if (d2 > radius * radius) continue;
      float w = film_filter_weight(radius, d2);
      sum += vec4(texture2D(textureSampler, vUV + vec2(float(x), float(y)) * texelSize).rgb * w, w);
    }
  }
  gl_FragColor = sum * weightScale;
}`;

ShaderStore.ShadersStore.blenderFilmResolveFragmentShader = `precision highp float;
varying vec2 vUV;
uniform sampler2D textureSampler;
void main(void) {
  vec4 film = texture2D(textureSampler, vUV);
  gl_FragColor = vec4(film.rgb / max(film.a, 1e-8), 1.0);
}`;

// The jitter of a view's sample, in pixels, within its pixel (Halton bases 2 and 3, as EEVEE's sampling draws it).
export const filmJitter = (sample) => [halton(sample + 1, 2) - 0.5, halton(sample + 1, 3) - 0.5];

// The index of the sample a scene's film is adding, or null when it adds none; effects that vary per sample (light
// shadows, light-shadows.js) draw it as EEVEE draws that sample.
const sampling = new WeakMap();
export const filmSample = (scene) => sampling.get(scene) ?? null;

export function createFilm(scene, camera) {
  const engine = scene.getEngine(), type = Constants.TEXTURETYPE_HALF_FLOAT;
  const film = new PostProcess('__film', 'blenderFilm', ['texelSize', 'jitter', 'radius', 'weightScale'], null, 1, null, Constants.TEXTURE_NEAREST_SAMPLINGMODE, engine, false, null, type);
  const resolve = new PostProcess('__filmResolve', 'blenderFilmResolve', null, null, 1, null, Constants.TEXTURE_NEAREST_SAMPLINGMODE, engine, false, null, type);
  camera.attachPostProcess(film, 0);
  camera.attachPostProcess(resolve, 1);
  film.alphaMode = Constants.ALPHA_ONEONE_ONEONE;
  // Its input is the scene's render, cleared to the world as the first post-process's is.
  film.forceAutoClearInAlphaMode = true;
  // The scene's depth as a texture, which the overlays draw against (draw/overlay-pass.js).
  const stencil = engine.isStencilEnable;
  film.onSizeChangedObservable.add(() => {
    const target = film.inputTexture;
    if (!target.depthStencilTexture) target.createDepthStencilTexture(0, false, stencil, 1, stencil ? Constants.TEXTUREFORMAT_DEPTH24_STENCIL8 : Constants.TEXTUREFORMAT_DEPTH24);
  });
  const state = { jitter: [0, 0], adding: true, clear: true, size: '' };
  // The resolve's input is the film's sum: cleared once per reset (and when its size changes), then each sample adds to it.
  resolve.autoClear = false;
  resolve.onActivateObservable.add(() => {
    const size = `${resolve.width}x${resolve.height}`;
    if (!state.clear && size === state.size) return;
    Object.assign(state, { clear: false, size });
    engine.clear({ r: 0, g: 0, b: 0, a: 0 }, true, false, false);
  });
  film.onApply = (effect) => {
    effect.setFloat2('texelSize', 1 / film.width, 1 / film.height);
    effect.setFloat2('jitter', state.jitter[0], state.jitter[1]);
    effect.setFloat('radius', FILTER_RADIUS);
    effect.setFloat('weightScale', state.adding ? 1 : 0);
  };
  // A view's samples while it stays the same (EEVEE's viewport): up to `samples()` of them, each jittered; any change of
  // its view, size or compiled shaders, or a reset() (Main evaluated), starts again. `manual` leaves the
  // samples to a render (frames.js), which jitters and adds them itself.
  let count = 0, signature = '', jittered = false, drawn = 0;
  const viewOf = () => {
    const projection = camera.getProjectionMatrix(true).m, effects = engine._compiledEffects ? Object.keys(engine._compiledEffects).length : 0;
    return [...camera.getViewMatrix().m, ...projection, engine.getRenderWidth(), engine.getRenderHeight(), effects].join();
  };
  const before = scene.onBeforeCameraRenderObservable.add((rendering) => {
    if (rendering !== camera || controls.manual) return;
    const now = viewOf();
    if (now !== signature) { signature = now; count = 0; state.clear = true; }
    if (count >= controls.samples()) { controls.sample(null); return; }
    const jitter = filmJitter(count), width = engine.getRenderWidth() * camera.viewport.width, height = engine.getRenderHeight() * camera.viewport.height;
    camera.freezeProjectionMatrix(Matrix.FromArray(jitterProjection(Array.from(camera.getProjectionMatrix(true).m), jitter, width, height, camera.mode === Camera.ORTHOGRAPHIC_CAMERA)));
    // The scene took the camera's matrices before this observer: it takes them again, jittered.
    scene.updateTransformMatrix(true);
    jittered = true;
    controls.sample(jitter, count);
  });
  const after = scene.onAfterCameraRenderObservable.add((rendering) => {
    if (rendering !== camera) return;
    setDitherOffset(scene, 0);
    sampling.delete(scene);
    if (!jittered) return;
    camera.unfreezeProjectionMatrix();
    jittered = false;
    count++;
  });
  const controls = {
    manual: false,
    // The render target the scene draws into, its depth a texture.
    target: () => film.inputTexture ?? null,
    samples: () => 1,
    // Starts again: the next sample is the first.
    reset() { state.clear = true; count = 0; },
    // The sample about to render: its jitter and index, or none to add (the film is complete and keeps what it holds).
    sample(jitter, index = 0) {
      state.adding = !!jitter;
      sampling.set(scene, jitter ? index : null);
      if (jitter) state.jitter = jitter;
      setDitherOffset(scene, jitter ? halton((drawn = (drawn % 4096) + 1), 2) : 0);
    },
    dispose() {
      scene.onBeforeCameraRenderObservable.remove(before);
      scene.onAfterCameraRenderObservable.remove(after);
      if (jittered) camera.unfreezeProjectionMatrix();
      film.dispose(camera);
      resolve.dispose(camera);
    },
  };
  return controls;
}
