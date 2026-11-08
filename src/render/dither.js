// The noise offset of hashed transparency (EEVEE's Dithered render method) for the sample a scene's view is drawing:
// one of a low-discrepancy sequence for each sample a film accumulates, so the samples average the coverage as EEVEE's
// do (sampling_rng_1D_get(SAMPLING_TRANSPARENCY)), and 0 where nothing accumulates, so a still view does not shimmer.
const offsets = new WeakMap();
export const ditherOffset = (scene) => offsets.get(scene) ?? 0;
export const setDitherOffset = (scene, offset) => offsets.set(scene, offset);
