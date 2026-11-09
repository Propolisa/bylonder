// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// Override of WebGPU's rules for GLSL: WGSL's derivative uniformity analysis off for every shader converted from GLSL (Babylon's own switch, which writes diagnostic(off, derivative_uniformity)), as GLSL takes derivatives and samples in any control flow; goes when Babylon does this for converted GLSL itself.

/**
 * The engine, converting GLSL with WGSL's uniformity analysis off; any other engine as it is.
 * @param {import('@babylonjs/core').AbstractEngine} engine
 */
export function derivativeUniformity(engine) {
  if (!engine.isWebGPU) return engine;
  const gpu = /** @type {any} */ (engine), stages = gpu._createPipelineStageDescriptor.bind(gpu);
  gpu._createPipelineStageDescriptor = (/** @type {any} */ vertex, /** @type {any} */ fragment, /** @type {number} */ language, /** @type {any[]} */ ...uniformity) =>
    stages(vertex, fragment, language, ...(language === 0 ? [true, true] : uniformity));
  return engine;
}
