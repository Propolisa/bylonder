// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// Override of Babylon's render target textures (RenderTargetTexture.render, patched on its prototype): one that is its scene's environment (a reflection probe's cube) draws the scene without it, as Babylon lets the materials it draws sample the texture they draw into, which WebGPU rejects and WebGL reads as a feedback loop (Still Life's and Orrery's probes); goes when Babylon leaves a target's own texture out of its pass.
import { RenderTargetTexture } from '@babylonjs/core/Materials/Textures/renderTargetTexture.js';

const render = RenderTargetTexture.prototype.render;
/** @this {RenderTargetTexture} @param {boolean} [useCameraPostProcess] @param {boolean} [dumpForDebug] */
RenderTargetTexture.prototype.render = function (useCameraPostProcess, dumpForDebug) {
  const scene = this.getScene();
  if (!scene || scene.environmentTexture !== this) return render.call(this, useCameraPostProcess, dumpForDebug);
  scene.environmentTexture = null;
  try {
    render.call(this, useCameraPostProcess, dumpForDebug);
  } finally {
    scene.environmentTexture = this;
  }
};
