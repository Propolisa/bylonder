// The noise of hashed transparency (EEVEE's Dithered render method) for the sample a scene's view is drawing: a seed
// that changes with each sample a film accumulates, so the samples average the coverage as EEVEE's do, and 0 where
// nothing accumulates, so a still view does not shimmer.
const seeds = new WeakMap();
export const ditherSeed = (scene) => seeds.get(scene) ?? 0;
export const setDitherSeed = (scene, seed) => seeds.set(scene, seed);
