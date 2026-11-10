// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// Override of Babylon's WebGPUEngine defaults: an engine asks for the adapter's highest limits and every feature, as WebGPU's defaults (16 values between a shader's stages) are fewer than Bylonder's materials use (Hair Dynamics' strands pass 17); goes when Babylon asks for them itself.

/** Options for `WebGPUEngine.CreateAsync(canvas, { ...WEBGPU_OPTIONS })`, an exported page's as the app's. */
export const WEBGPU_OPTIONS = { setMaximumLimits: true, enableAllFeatures: true };

let warned = false;
/**
 * Warns once in the console when a WebGPU engine has fewer limits than its adapter offers.
 * @param {import('@babylonjs/core').AbstractEngine} engine
 */
export function warnUnlessMaximumLimits(engine) {
  const gpu = /** @type {any} */ (engine), device = gpu._device?.limits, adapter = gpu._adapter?.limits;
  if (warned || !engine.isWebGPU || !device || !adapter) return;
  const lower = ['maxInterStageShaderVariables', 'maxSampledTexturesPerShaderStage', 'maxSamplersPerShaderStage', 'maxUniformBuffersPerShaderStage']
    .filter((name) => device[name] < adapter[name]);
  if (!lower.length) return;
  warned = true;
  console.warn(`This WebGPU engine has fewer limits than its adapter (${lower.join(', ')}): some materials may fail to compile. `
    + 'Create it with WebGPUEngine.CreateAsync(canvas, { ...WEBGPU_OPTIONS }) from bylonder/overrides/webgpu/maximum-limits.js.');
}
