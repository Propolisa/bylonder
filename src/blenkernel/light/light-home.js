// A light's home world (docs/blender-boundary.md point 4a). A light Blender's code made (Add > Light, a .blend) keeps
// all of Blender's Light settings in RNA's terms (`metadata.wbLight`), and its Babylon light is derived from them; a
// light project code made is Babylon's, and Blender's Light is derived from it. Derivation follows Blender's glTF
// exporter (io_scene_gltf2 blender/exp/lights.py and light_spots.py), the conversion Blender itself ships to Babylon.
import { DirectionalLight, Light, PointLight, SpotLight, Vector3 } from '@babylonjs/core';
import { AreaLight } from './area-light.js';
import { asObject } from '../../runtime/object-transform.js';
import { rnaProperty } from '../../makesrna/rna.js';
import { lightFields, lightStruct } from './light-fields.js';

export const BLENDER = 'BLENDER';
// A camera Blender's code made has its home there too (main-view.js MAKERS).
export const isBlenderLight = (light) => light instanceof Light && light.metadata?.wbHome === BLENDER;
export const lightRecord = (light) => light.metadata?.wbLight;

// The glTF exporter's lighting modes: Unitless (COMPAT, its candela without the 683 lm/W), Standard (SPEC, physical)
// and Raw. A scene's choice is kept on the scene.
const PBR_WATTS_TO_LUMENS = 683;
export const lightingMode = (scene) => scene?.metadata?.wbLightingMode ?? 'COMPAT';

// Blender's power (W, or W/m² for a sun) as Babylon's intensity, and back. An area light's is its radiance, as EEVEE
// converts it (blender-port: eevee_light.cc Light::shape_radiance_get: 1 / (pi * area)), `area` its shape's in m²;
// Babylon's rectangular light takes radiance.
export function intensityOf(type, watts, mode, area = 1) {
  if (mode === 'RAW') return watts;
  const luminous = type === 'SUN' ? watts : type === 'AREA' ? watts / (Math.PI * area) : watts / (4 * Math.PI);
  return mode === 'SPEC' ? luminous * PBR_WATTS_TO_LUMENS : luminous;
}
export const wattsOf = (type, intensity, mode, area = 1) => intensity / intensityOf(type, 1, mode, area);
// An Area light's surface in m²: its rectangle's, a disk's or ellipse's the inscribed one (pi / 4 of it).
export const areaOf = (record) => {
  const rectangle = ['RECTANGLE', 'ELLIPSE'].includes(record.shape), area = record.size * (rectangle ? record.size_y : record.size);
  return ['DISK', 'ELLIPSE'].includes(record.shape) ? area * Math.PI / 4 : area;
};

// A Blender light of a type in a scene (bpy.data.lights.new with its object): the Babylon light nearest it, made
// Blender's with the settings given. An Area light is Babylon's rectangular one (a disk or ellipse its bounding
// rectangle) with a shadow (area-light.js).
export function createLight(name, type, settings = {}, scene) {
  const light = asObject(type === 'SPOT' ? new SpotLight(name, Vector3.Zero(), new Vector3(0, 0, 1), Math.PI / 4, 1, scene)
    : type === 'SUN' ? new DirectionalLight(name, new Vector3(0, 0, 1), scene) : type === 'AREA' ? new AreaLight(name, Vector3.Zero(), 1, 1, scene)
      : new PointLight(name, Vector3.Zero(), scene));
  makeBlenderLight(light, type, settings);
  return light;
}

// Makes a light Blender's, with the settings given and Blender's defaults for the rest.
export function makeBlenderLight(light, type, values = {}) {
  const defaults = Object.fromEntries(lightFields(type).map((name) => [name, rnaProperty(lightStruct(type), name)?.default]));
  const record = { ...defaults, ...values, type };
  light.metadata = { ...light.metadata, wbHome: BLENDER, wbLight: record };
  deriveBabylonLight(light);
  return record;
}

// The Babylon light as Blender's Light gives it.
export function deriveBabylonLight(light) {
  const record = lightRecord(light);
  // EEVEE's light powers per closure (eevee_light.cc Light::sync): its color times its Diffuse and Specular factors.
  light.diffuse.copyFromFloats(...record.color).scaleInPlace(record.diffuse_factor ?? 1);
  light.specular.copyFromFloats(...record.color).scaleInPlace(record.specular_factor ?? 1);
  light.intensity = intensityOf(record.type, record.energy * 2 ** (record.exposure ?? 0), lightingMode(light.getScene()), record.type === 'AREA' ? areaOf(record) : 1);
  if (record.type !== 'SUN') light.falloffType = Light.FALLOFF_GLTF;
  // An area light's extent is its size; a radius would zero its photometric scale, which Babylon has no case for.
  if (record.type !== 'AREA') light.radius = shapeRadius(record);
  light.shadowEnabled = record.use_shadow;
  // EEVEE fades a light to nothing at its influence radius as Babylon's glTF falloff does at its range.
  if (record.type !== 'SUN') light.range = influenceRadius(record).surface;
  if (record.type === 'SPOT') {
    light.angle = record.spot_size;
    light.innerAngle = (1 - record.spot_blend) * record.spot_size;
  }
  if (record.type === 'AREA') {
    light.width = record.size;
    light.height = ['RECTANGLE', 'ELLIPSE'].includes(record.shape) ? record.size_y : record.size;
  }
}

// blender-port: DNA_scene_defaults.h light_threshold: the scene's default Light Threshold.
const LIGHT_THRESHOLD = 0.01;
// blender-port: eevee_light.cc Light::shape_parameters_set and attenuation_radius_get: where a point, spot or area
// light's power falls to the light threshold (its Custom Distance, if it has one), for its surface lighting (its
// diffuse and specular factors) and at most (its volume factor too).
export function influenceRadius(record) {
  const power = Math.max(...record.color) * Math.abs(record.energy * 2 ** (record.exposure ?? 0) / 100);
  const radius = (factor) => (record.use_custom_distance ? record.cutoff_distance : Math.sqrt(factor * power / LIGHT_THRESHOLD));
  const surface = radius(Math.max(record.diffuse_factor ?? 1, record.specular_factor ?? 1)), volume = radius(record.volume_factor ?? 1);
  return { surface, max: Math.max(surface, volume) };
}

// blender-port: eevee_light.cc Light::shape_parameters_set: a sun's radius at unit distance from its angle, a point's or
// spot's its soft size, neither below 0.001.
const SUN_MAX_ANGLE = (179.9 * Math.PI) / 180;
const shapeRadius = (record) => (record.type === 'SUN' ? Math.min(Math.max(Math.tan(Math.min(record.angle, SUN_MAX_ANGLE) / 2), 0.001), 20)
  : Math.max(0.001, record.shadow_soft_size));

// What the other world does not show of a light, for Info when it is exported or saved: a Blender light as Babylon's,
// a Babylon light as Blender's.
export function lightLosses(light) {
  const name = `"${light.name}"`;
  if (isBlenderLight(light)) {
    const r = lightRecord(light), lost = [];
    if (r.type === 'AREA' && ['DISK', 'ELLIPSE'].includes(r.shape)) lost.push(`an Area light's ${r.shape.toLowerCase()} shape, shown as its rectangle`);
    if (r.use_temperature) lost.push('its color temperature');
    if (r.type === 'SUN' && r.angle > 0) lost.push('the sun\'s angle (soft shadows)');
    if (r.use_soft_falloff === false) lost.push('hard falloff');
    for (const factor of ['transmission_factor', 'volume_factor']) if (r[factor] !== 1) lost.push(factor.replace('_', ' '));
    return lost.map((what) => `${name}: ${what} has no Babylon equivalent`);
  }
  const lost = [];
  if (light.getClassName() === 'HemisphericLight') lost.push('a hemispheric light saved as a sun: its ground color');
  if (!light.specular.equals(light.diffuse)) lost.push('a specular color apart from its color');
  if (light.includedOnlyMeshes.length || light.excludedMeshes.length) lost.push('the meshes it lights');
  if (light.falloffType !== Light.FALLOFF_DEFAULT && light.falloffType !== Light.FALLOFF_GLTF && light.falloffType !== Light.FALLOFF_PHYSICAL) lost.push('its falloff');
  return lost.map((what) => `${name}: ${what} has no Blender equivalent`);
}

// What crossing to a world ('BLENDER' saving a .blend, 'BABYLON' exporting) loses of the lights whose home is the other.
export const crossingLosses = (objects, to) => objects.filter((ob) => ob instanceof Light && isBlenderLight(ob) !== (to === BLENDER)).flatMap(lightLosses);
