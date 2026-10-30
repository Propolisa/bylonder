// A light's home world (docs/blender-boundary.md point 4a). A light Blender's code made (Add > Light, a .blend) keeps
// all of Blender's Light settings in RNA's terms (`metadata.wbLight`), and its Babylon light is derived from them; a
// light project code made is Babylon's, and Blender's Light is derived from it. Derivation follows Blender's glTF
// exporter (io_scene_gltf2 blender/exp/lights.py and light_spots.py), the conversion Blender itself ships to Babylon.
import { DirectionalLight, Light, PointLight, RectAreaLight, SpotLight, Vector3 } from '@babylonjs/core';
import { asObject } from '../../runtime/object-transform.js';
import { rnaProperty } from '../../makesrna/rna.js';
import { lightFields, lightStruct } from './light-fields.js';

export const BLENDER = 'BLENDER';
export const isBlenderLight = (light) => light.metadata?.wbHome === BLENDER;
export const lightRecord = (light) => light.metadata?.wbLight;

// The glTF exporter's lighting modes: Unitless (COMPAT, its candela without the 683 lm/W), Standard (SPEC, physical)
// and Raw. A scene's choice is kept on the scene.
const PBR_WATTS_TO_LUMENS = 683;
export const lightingMode = (scene) => scene?.metadata?.wbLightingMode ?? 'COMPAT';

// Blender's power (W, or W/m² for a sun) as Babylon's intensity, and back.
export function intensityOf(type, watts, mode) {
  if (mode === 'RAW') return watts;
  const luminous = type === 'SUN' ? watts : watts / (4 * Math.PI);
  return mode === 'SPEC' ? luminous * PBR_WATTS_TO_LUMENS : luminous;
}
export const wattsOf = (type, intensity, mode) => intensity / intensityOf(type, 1, mode);

// A Blender light of a type in a scene (bpy.data.lights.new with its object): the Babylon light nearest it, made
// Blender's with the settings given. An Area light is Babylon's rectangular one (a disk or ellipse its bounding
// rectangle).
export function createLight(name, type, settings = {}, scene) {
  const light = asObject(type === 'SPOT' ? new SpotLight(name, Vector3.Zero(), new Vector3(0, 0, 1), Math.PI / 4, 1, scene)
    : type === 'SUN' ? new DirectionalLight(name, new Vector3(0, 0, 1), scene) : type === 'AREA' ? new RectAreaLight(name, Vector3.Zero(), 1, 1, scene)
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
  light.diffuse.copyFromFloats(...record.color);
  light.intensity = intensityOf(record.type, record.energy * 2 ** (record.exposure ?? 0), lightingMode(light.getScene()));
  if (record.type !== 'SUN') light.falloffType = Light.FALLOFF_GLTF;
  if ('radius' in light) light.radius = record.shadow_soft_size;
  light.shadowEnabled = record.use_shadow;
  light.range = record.use_custom_distance ? record.cutoff_distance : Number.MAX_VALUE;
  if (record.type === 'SPOT') {
    light.angle = record.spot_size;
    light.innerAngle = (1 - record.spot_blend) * record.spot_size;
  }
  if (record.type === 'AREA') {
    light.width = record.size;
    light.height = ['RECTANGLE', 'ELLIPSE'].includes(record.shape) ? record.size_y : record.size;
  }
}

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
    for (const factor of ['diffuse_factor', 'specular_factor', 'transmission_factor', 'volume_factor']) if (r[factor] !== 1) lost.push(factor.replace('_', ' '));
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
