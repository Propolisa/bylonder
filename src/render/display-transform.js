// A view's display transform on its scene linear image, in Blender's order (colormanagement.cc): exposure, then the
// view transform and look (Blender's processor on a log shaped lattice, display-lut.js), then the view gamma
// (colormanage_exponent's exponent of 1 / gamma, at most 100). Until the lattice exists the view transform is
// Standard's sRGB encoding. A rendered view's camera ends with it, as the compositor's Group Output does
// (nodes/blender/compositor-io.js); both read the scene's display settings, which its render engine sets.
import { Constants, Effect, EffectWrapper, PostProcess, RawTexture3D } from '@babylonjs/core';
import { displayExponent } from './view-settings.js';
import { LOG_SIZE, STOPS } from './display-lut.js';
import { DISPLAY_UNIFORMS, displayTransformShader } from '../io_scene_babylon/runtime/view-transform.js';

const SHADER = 'bylonderDisplayTransform', UNIFORMS = DISPLAY_UNIFORMS, SAMPLERS = ['lattice'];
Effect.ShadersStore[`${SHADER}FragmentShader`] = displayTransformShader(LOG_SIZE, STOPS);

// The scene's display settings: () => { exposure (stops), gamma, lut (display-lut.js's log lattice, or null) }.
const settingsOf = new WeakMap();
export const setDisplaySettings = (scene, settings) => settingsOf.set(scene, settings);
const NEUTRAL = { exposure: 0, gamma: 1, lut: null, background: null };

// The lattice sampler's texture while there is no lattice: a 3D sampler takes a 3D texture.
let none = null;
function bind(effect, scene) {
  const { exposure, gamma, lut, background } = settingsOf.get(scene)?.() ?? NEUTRAL;
  if (background) effect.setFloat4('background', background.r, background.g, background.b, 1); else effect.setFloat4('background', 0, 0, 0, 0);
  effect.setFloat('exposure', 2 ** exposure);
  effect.setFloat('exponent', displayExponent(gamma));
  effect.setFloat('latticed', lut ? 1 : 0);
  effect.setFloat('range', lut?.range ?? 1);
  effect.setTexture('lattice', lut?.texture ?? (none ??= new RawTexture3D(new Uint8Array(4), 1, 1, 1, Constants.TEXTUREFORMAT_RGBA, scene, false)));
}

// A camera's last post-process. Its input is the scene linear image the effects before it draw, so it keeps half floats:
// in 8 bits the darks band (a linear step of 1/255 is 13 display levels).
export function createDisplayTransform(name, camera) {
  const post = new PostProcess(name, SHADER, UNIFORMS, SAMPLERS, 1, camera, Constants.TEXTURE_BILINEAR_SAMPLINGMODE, undefined, false, null, Constants.TEXTURETYPE_HALF_FLOAT);
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
