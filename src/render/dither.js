import { glslFunction, guardedDefinitions } from '../nodes/blender/glsl.js';

// The noise offset of hashed transparency (EEVEE's Dithered render method) for the sample a scene's view is drawing:
// one of a low-discrepancy sequence for each sample a film accumulates, so the samples average the coverage as EEVEE's
// do (sampling_rng_1D_get(SAMPLING_TRANSPARENCY)), and 0 where nothing accumulates, so a still view does not shimmer.
const offsets = new WeakMap();
export const ditherOffset = (scene) => offsets.get(scene) ?? 0;
export const setDitherOffset = (scene, offset) => offsets.set(scene, offset);
// EEVEE's Dithered thresholds, Blender's own GLSL (eevee_transparency.bsl.hh alpha_threshold, eevee_sampling_lib
// pcg4d) and its calls: eevee_surf_depth hashes a surface point's threshold (hash scale 1), eevee_surf_shadow takes a
// random one per point for a shadow map (Babylon's shadow shaders define SM_FLOAT), each shifted by the sample's offset.
export const DITHER_FUNCTIONS = [...glslFunction('alpha_threshold'), ...glslFunction('pcg4d'), ['bl_dither', `float bl_dither(vec3 P, float offset) {
#ifdef SM_FLOAT
  return bl_pcg4d(vec4(P, offset)).x;
#else
  return bl_alpha_threshold(1.0, offset, P);
#endif
}
`]];
export const DITHER_NOISE = guardedDefinitions(DITHER_FUNCTIONS);
