// Blender's view gamma (scene.view_settings.gamma): an exponent of 1 / gamma, at most 100, on the displayed color after
// the view transform (colormanagement.cc colormanage_exponent, the display processor's exponent). Babylon's image
// processing has none, so a post-process after it raises its output.
import { Effect, PostProcess } from '@babylonjs/core';
import { displayExponent } from './view-settings.js';

const SHADER = 'bylonderDisplayGamma';
Effect.ShadersStore[`${SHADER}FragmentShader`] = `precision highp float;
varying vec2 vUV;
uniform sampler2D textureSampler;
uniform float exponent;
void main(void) {
  vec4 color = texture2D(textureSampler, vUV);
  gl_FragColor = vec4(pow(max(color.rgb, 0.0), vec3(exponent)), color.a);
}`;

// A camera's last post-process, raising its color to the exponent of `gamma()`.
export function createDisplayGamma(name, camera, gamma) {
  const post = new PostProcess(name, SHADER, ['exponent'], null, 1, camera);
  post.onApply = (effect) => effect.setFloat('exponent', displayExponent(gamma()));
  return post;
}
