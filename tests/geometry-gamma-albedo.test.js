// Babylon's geometry buffer shader in WGSL converts a gamma albedo texture's vec3 color with the vec3 conversion, which
// WebGPU accepts, however Babylon's shader module loads after the override.
import assert from 'node:assert/strict';
import { ShaderStore } from '@babylonjs/core';
import '../src/overrides/babylon/geometry-gamma-albedo.js';
import '@babylonjs/core/ShadersWGSL/geometry.fragment.js';

const shader = ShaderStore.ShadersStoreWGSL.geometryPixelShader;
assert.match(shader, /#ifdef GAMMAALBEDO\ncolor=toLinearSpaceVec3\(color\);/, 'the vec3 conversion');
assert.doesNotMatch(shader, /toLinearSpaceVec4\(color\)/, 'no vec4 conversion of the vec3');
console.log('Geometry gamma albedo: the WGSL converts its vec3 color');
