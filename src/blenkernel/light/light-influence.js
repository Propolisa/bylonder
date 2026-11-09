// A light's reach, which needs nothing but its record: exported pages' volumes read it too (draw/volume-passes.js).

// blender-port: DNA_scene_defaults.h light_threshold: the scene's default Light Threshold.
const LIGHT_THRESHOLD = 0.01;
// blender-port: eevee_light.cc Light::shape_parameters_set and attenuation_radius_get: where a point, spot or area
// light's power falls to the light threshold (its Custom Distance, if it has one), for its surface lighting (its
// diffuse and specular factors), for volumes (its volume factor) and at most.
export function influenceRadius(record) {
  const power = Math.max(...record.color) * Math.abs(record.energy * 2 ** (record.exposure ?? 0) / 100);
  const radius = (factor) => (record.use_custom_distance ? record.cutoff_distance : Math.sqrt(factor * power / LIGHT_THRESHOLD));
  const surface = radius(Math.max(record.diffuse_factor ?? 1, record.specular_factor ?? 1)), volume = radius(record.volume_factor ?? 1);
  return { surface, volume, max: Math.max(surface, volume) };
}
