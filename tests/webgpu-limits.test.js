// Exported pages on WebGPU (src/overrides/webgpu/maximum-limits.js): the options that ask for the adapter's limits, and
// a warning, once, when a page's WebGPU engine has fewer, instead of a material's cryptic shader error later.
import assert from 'node:assert/strict';
import { NullEngine } from '@babylonjs/core';
import { WEBGPU_OPTIONS, warnUnlessMaximumLimits } from '../src/overrides/webgpu/maximum-limits.js';

assert.deepEqual(WEBGPU_OPTIONS, { setMaximumLimits: true, enableAllFeatures: true });
const warnings = [], warn = console.warn;
console.warn = (message) => warnings.push(message);
const engine = (inter) => ({ isWebGPU: true, _device: { limits: { maxInterStageShaderVariables: inter } }, _adapter: { limits: { maxInterStageShaderVariables: 28 } } });
warnUnlessMaximumLimits(new NullEngine());
warnUnlessMaximumLimits(engine(28));
assert.deepEqual(warnings, [], 'no warning on WebGL or with the maximum limits');
warnUnlessMaximumLimits(engine(16));
warnUnlessMaximumLimits(engine(16));
console.warn = warn;
assert.equal(warnings.length, 1, 'one warning');
assert.match(warnings[0], /maxInterStageShaderVariables.*WEBGPU_OPTIONS/);
console.log("WebGPU limits: pages ask for the adapter's, and are told once when their engine has fewer");
