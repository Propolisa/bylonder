// The noise offset of hashed transparency (EEVEE's Dithered render method) for the sample a scene's view is drawing:
// one of a low-discrepancy sequence for each sample a film accumulates, so the samples average the coverage as EEVEE's
// do (sampling_rng_1D_get(SAMPLING_TRANSPARENCY)), and 0 where nothing accumulates, so a still view does not shimmer.
const offsets = new WeakMap();
export const ditherOffset = (scene) => offsets.get(scene) ?? 0;
export const setDitherOffset = (scene, offset) => offsets.set(scene, offset);
// blender-port: gpu_shader_math_base_lib interleaved_gradient_noise and eevee_nodetree_lib hashed_alpha_threshold:
// the pixel's noise shifted by the sample's offset, so the samples a film averages cover every threshold.
export const DITHER_NOISE = `float bl_dither(vec2 pixel, float offset) {
  return fract(offset + 52.9829189 * fract(0.06711056 * pixel.x + 0.00583715 * pixel.y));
}
`;
