// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// Override of Babylon's shadow map shader (its normal bias, shadowMapVertexNormalBias written out in a shader of its own, made once ShadowGenerator has loaded Babylon's): a face turned away from the light moves away from it, by less the more it is edge-on, where Babylon's moves every caster along -N so that such a face shadows itself though EEVEE lights it from behind; and a point or spot light's bias (BIAS_PER_METER) is per meter from the light, as EEVEE's is a share of a texel there, where Babylon's moves casters the same distance everywhere so that a lamp's housing around its light swells over it; goes when Babylon's normal bias spares back faces and scales with its texels.
import { ShaderStore, ShadowGenerator } from '@babylonjs/core';

// The shadow generators' shader (customShaderOptions.shaderName).
export const SHADOW_MAP = 'blenderShadowMap';
// The define (customShaderOptions.defines) that scales a generator's normal bias by the distance to its light.
export const BIAS_PER_METER = '#define SM_BIAS_PER_METER';
const INCLUDE = '#include<shadowMapVertexNormalBias>';
const GLSL = `#if SM_NORMALBIAS==1
#if SM_DIRECTIONINLIGHTDATA==1
vec3 worldLightDirSM=normalize(-lightDataSM.xyz);float lightDistanceSM=1.0;
#else
vec3 directionToLightSM=lightDataSM.xyz-worldPos.xyz;vec3 worldLightDirSM=normalize(directionToLightSM);
#ifdef SM_BIAS_PER_METER
float lightDistanceSM=length(directionToLightSM);
#else
float lightDistanceSM=1.0;
#endif
#endif
float ndlSM=dot(vNormalW,worldLightDirSM);float sinNLSM=sqrt(1.0-ndlSM*ndlSM);float normalBiasSM=biasAndScaleSM.y*lightDistanceSM*(0.0<ndlSM?sinNLSM:ndlSM);worldPos.xyz-=vNormalW*normalBiasSM;
#endif
`;
const WGSL = `#if SM_NORMALBIAS==1
#if SM_DIRECTIONINLIGHTDATA==1
var worldLightDirSM: vec3f=normalize(-uniforms.lightDataSM.xyz);var lightDistanceSM: f32=1.0;
#else
var directionToLightSM: vec3f=uniforms.lightDataSM.xyz-worldPos.xyz;var worldLightDirSM: vec3f=normalize(directionToLightSM);
#ifdef SM_BIAS_PER_METER
var lightDistanceSM: f32=length(directionToLightSM);
#else
var lightDistanceSM: f32=1.0;
#endif
#endif
var ndlSM: f32=dot(vNormalW,worldLightDirSM);var sinNLSM: f32=sqrt(1.0-ndlSM*ndlSM);var normalBiasSM: f32=uniforms.biasAndScaleSM.y*lightDistanceSM*select(ndlSM,sinNLSM,0.0<ndlSM);worldPos=vec4f(worldPos.xyz-vNormalW*normalBiasSM,worldPos.w);
#endif
`;

function register() {
  for (const [store, bias] of /** @type {const} */ ([[ShaderStore.ShadersStore, GLSL], [ShaderStore.ShadersStoreWGSL, WGSL]])) {
    const vertex = store.shadowMapVertexShader;
    if (!vertex || store[`${SHADOW_MAP}VertexShader`]) continue;
    if (!vertex.includes(INCLUDE)) throw Error(`Babylon's shadow map shader no longer includes ${INCLUDE}`);
    store[`${SHADOW_MAP}VertexShader`] = vertex.replace(INCLUDE, bias);
    store[`${SHADOW_MAP}PixelShader`] = store.shadowMapPixelShader;
  }
}

const prototype = /** @type {any} */ (ShadowGenerator.prototype), init = prototype._initShaderSourceAsync;
/** @param {boolean} [forceGLSL] */
prototype._initShaderSourceAsync = async function (forceGLSL) {
  await init.call(this, forceGLSL);
  register();
};
