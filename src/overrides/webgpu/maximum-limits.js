// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// Override of Babylon's WebGPUEngine defaults: an engine asks for the adapter's highest limits and every feature, as WebGPU's defaults (16 values between a shader's stages) are fewer than Bylonder's materials use (Hair Dynamics' strands pass 17); goes when Babylon asks for them itself.

/** Options for `WebGPUEngine.CreateAsync(canvas, { ...WEBGPU_OPTIONS })`, an exported page's as the app's. */
export const WEBGPU_OPTIONS = { setMaximumLimits: true, enableAllFeatures: true };
