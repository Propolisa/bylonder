// SPDX-License-Identifier: MIT OR Apache-2.0
// Override of Babylon's shadow map shader (its normal bias, through #include<name>(from,to) remapping): a face turned away from the light moves away from it, by less the more it is edge-on, where Babylon's moves every caster along -N so that such a face shadows itself though EEVEE lights it from behind; WGSL's remapping holds no commas, so no select(); goes when Babylon's normal bias spares back faces.
import { ShaderStore } from '@babylonjs/core';
import { shadowMapVertexShader } from '@babylonjs/core/Shaders/shadowMap.vertex.js';
import { shadowMapPixelShader } from '@babylonjs/core/Shaders/shadowMap.fragment.js';
import { shadowMapVertexShaderWGSL } from '@babylonjs/core/ShadersWGSL/shadowMap.vertex.js';
import { shadowMapPixelShaderWGSL } from '@babylonjs/core/ShadersWGSL/shadowMap.fragment.js';

// The shadow generators' shader (customShaderOptions.shaderName).
export const SHADOW_MAP = 'blenderShadowMap';
const litSide = (vertex, bias) => vertex.shader.replace('#include<shadowMapVertexNormalBias>', `#include<shadowMapVertexNormalBias>(sinNLSM;worldPos,${bias};worldPos)`);
ShaderStore.ShadersStore[`${SHADOW_MAP}VertexShader`] ??= litSide(shadowMapVertexShader, '(0.0<ndlSM?sinNLSM:ndlSM)');
ShaderStore.ShadersStore[`${SHADOW_MAP}PixelShader`] ??= shadowMapPixelShader.shader;
ShaderStore.ShadersStoreWGSL[`${SHADOW_MAP}VertexShader`] ??= litSide(shadowMapVertexShaderWGSL, '(f32(0.0<ndlSM)*(sinNLSM-ndlSM)+ndlSM)');
ShaderStore.ShadersStoreWGSL[`${SHADOW_MAP}PixelShader`] ??= shadowMapPixelShaderWGSL.shader;
