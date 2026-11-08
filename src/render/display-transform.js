// A view's display transform on its scene linear image, in Blender's order (colormanagement.cc): exposure, then the
// view transform and look (Blender's processor on a log shaped lattice, display-lut.js), then the view gamma
// (colormanage_exponent's exponent of 1 / gamma, at most 100). Until the lattice exists the view transform is
// Standard's sRGB encoding. A rendered view's camera ends with it, as the compositor's Group Output does
// (nodes/blender/compositor-io.js); both read the scene's display settings, which its render engine sets.
import { Constants, Effect, EffectWrapper, PostProcess, RawTexture3D } from '@babylonjs/core';
import { displayExponent } from './view-settings.js';
import { LOG_SIZE, STOPS } from './display-lut.js';

const SHADER = 'bylonderDisplayTransform', UNIFORMS = ['exposure', 'range', 'exponent', 'latticed'], SAMPLERS = ['lattice'];
Effect.ShadersStore[`${SHADER}FragmentShader`] = `precision highp float;
precision highp sampler3D;
varying vec2 vUV;
uniform sampler2D textureSampler;
uniform sampler3D lattice;
uniform float exposure, range, exponent, latticed;
vec3 srgb(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
void main(void) {
  vec4 color = texture2D(textureSampler, vUV);
  vec3 linear = max(color.rgb * exposure, 0.0), display;
  if (latticed > 0.5) {
    vec3 u = clamp(log2(max(linear / range, 1e-30)) / ${STOPS.toFixed(1)} + 1.0, 0.0, 1.0);
    display = texture(lattice, u * ${((LOG_SIZE - 1) / LOG_SIZE).toFixed(8)} + ${(0.5 / LOG_SIZE).toFixed(8)}).rgb;
  } else display = srgb(clamp(linear, 0.0, 1.0));
  gl_FragColor = vec4(pow(max(display, 0.0), vec3(exponent)), color.a);
}`;

// The scene's display settings: () => { exposure (stops), gamma, lut (display-lut.js's log lattice, or null) }.
const settingsOf = new WeakMap();
export const setDisplaySettings = (scene, settings) => settingsOf.set(scene, settings);
const NEUTRAL = { exposure: 0, gamma: 1, lut: null };

// The lattice sampler's texture while there is no lattice: a 3D sampler takes a 3D texture.
let none = null;
function bind(effect, scene) {
  const { exposure, gamma, lut } = settingsOf.get(scene)?.() ?? NEUTRAL;
  effect.setFloat('exposure', 2 ** exposure);
  effect.setFloat('exponent', displayExponent(gamma));
  effect.setFloat('latticed', lut ? 1 : 0);
  effect.setFloat('range', lut?.range ?? 1);
  effect.setTexture('lattice', lut?.texture ?? (none ??= new RawTexture3D(new Uint8Array(4), 1, 1, 1, Constants.TEXTUREFORMAT_RGBA, scene, false)));
}

// A camera's last post-process.
export function createDisplayTransform(name, camera) {
  const post = new PostProcess(name, SHADER, UNIFORMS, SAMPLERS, 1, camera);
  post.onApply = (effect) => bind(effect, camera.getScene());
  return post;
}

// The same as a frame graph's effect (a post process task's).
export class DisplayTransformEffect extends EffectWrapper {
  constructor(name, scene) {
    super({ name, engine: scene.getEngine(), fragmentShader: SHADER, useShaderStore: true, useAsPostProcess: true, uniforms: UNIFORMS, samplers: SAMPLERS });
    this.scene = scene;
  }
  bind(noDefaultBindings) {
    super.bind(noDefaultBindings);
    bind(this.drawWrapper.effect, this.scene);
  }
}
