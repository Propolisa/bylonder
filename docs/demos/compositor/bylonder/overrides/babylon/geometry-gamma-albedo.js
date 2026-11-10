// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// Override of Babylon's geometry buffer WGSL shader (geometryPixelShader in ShaderStore.ShadersStoreWGSL, fixed as Babylon stores it): a gamma albedo texture's color converted with toLinearSpaceVec3, as Babylon passes its vec3 to toLinearSpaceVec4, which WebGPU rejects, and the geometry buffer of a scene with such a texture (Orrery's planets) never draws; goes when Babylon's shader calls the vec3 conversion.
import { ShaderStore } from '@babylonjs/core/Engines/shaderStore.js';

const NAME = 'geometryPixelShader';
let shader = ShaderStore.ShadersStoreWGSL[NAME];
/** @param {string} code */
export const gammaAlbedoFixed = (code) => code?.replace('color=toLinearSpaceVec4(color);', 'color=toLinearSpaceVec3(color);');
Object.defineProperty(ShaderStore.ShadersStoreWGSL, NAME, {
  configurable: true, enumerable: true,
  get: () => shader,
  set: (code) => { shader = gammaAlbedoFixed(code); },
});
shader = gammaAlbedoFixed(shader);
