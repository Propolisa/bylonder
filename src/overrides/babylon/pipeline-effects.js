// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// Override of Babylon's DefaultRenderingPipeline serialization (serialize, Parse): its effects' settings (depth of field's lens and focus, chromatic aberration, grain, sharpen) written and read beside the switches Babylon keeps, as Babylon serializes only which effects are on and a page drew them at their defaults; goes when Babylon serializes its pipeline's effects.

/** The settings of each effect Babylon's serialization leaves out, by the pipeline's property holding the effect. */
const SETTINGS = {
  depthOfField: ['focalLength', 'fStop', 'focusDistance', 'lensSize'],
  chromaticAberration: ['aberrationAmount', 'radialIntensity', 'direction', 'centerPosition'],
  grain: ['intensity', 'animated'],
  sharpen: ['edgeAmount', 'colorAmount'],
};

/**
 * A pipeline serialized as Babylon does, with its effects' settings under `effects`.
 * @param {any} pipeline @returns {any}
 */
export function serializePipeline(pipeline) {
  const entry = pipeline.serialize();
  if (entry.customType !== 'DefaultRenderingPipeline') return entry;
  entry.effects = Object.fromEntries(Object.entries(SETTINGS).filter(([effect]) => pipeline[effect]).map(([effect, keys]) =>
    [effect, Object.fromEntries(keys.map((key) => [key, pipeline[effect][key]?.asArray?.() ?? pipeline[effect][key]]))]));
  return entry;
}

/**
 * The settings `serializePipeline` wrote, given to a pipeline Babylon parsed.
 * @param {any} pipeline @param {any} entry @returns {any}
 */
export function parsedPipeline(pipeline, entry) {
  for (const [effect, values] of Object.entries(entry.effects ?? {})) {
    const target = pipeline?.[effect];
    if (!target) continue;
    for (const [key, value] of Object.entries(values)) {
      if (Array.isArray(value)) target[key].fromArray(value);
      else target[key] = value;
    }
  }
  return pipeline;
}
