// An area light's specular as EEVEE's (and LTC's authors') weighs it: the surface's F0 and F90 over the split sum of the
// LTC lookup, times the light's color once. Babylon's own formula weighs the lookup by the light's color times its
// intensity, and then multiplies by it again, so a light given in radiance (Blender's power over its area, large for a
// small light) shines its intensity squared: a 365 W lamp 10 cm wide whites out a room. The formula is put right in the
// materials of Blender's data through Babylon's own extension points: a material plugin's code replacement for a PBR
// material, the include's replace strings for a node material's PBR block (nodes/blender/shader-nodes.js).
import { MaterialPluginBase } from '@babylonjs/core';

const NAME = 'BlenderAreaSpecular';
// blender-port: eevee_light_eval.bsl.hh light_eval_single_closure with eevee_bxdf_lut: F0 * lut.x + (F90 - F0) * lut.y.
export const AREA_SPECULAR = {
  search: /fresnel=specularColor\*info\.areaLightFresnel\.x\*reflectance0\+\( vec3\( 1\.0 \)-specularColor \)\*info\.areaLightFresnel\.y\*reflectance90;/,
  replace: 'fresnel=reflectance0*info.areaLightFresnel.x+(reflectance90-reflectance0)*info.areaLightFresnel.y;',
};
// blender-port: eevee_light.cc Light::sync: a light's specular power is its color times its Specular factor, apart from
// its diffuse. Babylon's PBR lights a punctual light's specular and coat with its diffuse color: they take its specular
// color (Light.specular), as an area light's already do.
export const LIGHT_SPECULAR = {
  search: /(info\.(?:specular|clearCoat)=compute(?:Anisotropic)?(?:Specular|ClearCoat)Lighting\([^;]*,)diffuse(\d+|\{X\})\.rgb\);/g,
  replace: '$1light$2.vLightSpecular.rgb);',
};
// Babylon's WGSL (WebGPU) writes the area formula as its own expression; the light's specular as its GLSL does.
const AREA_SPECULAR_WGSL = {
  search: /var fresnel:vec3f =reflectance0\*specularColor\*info\.areaLightFresnel\.x\+\( vec3f\( 1\.0 \)-specularColor \)\*info\.areaLightFresnel\.y\*reflectance90;/,
  replace: 'var fresnel:vec3f=reflectance0*info.areaLightFresnel.x+(reflectance90-reflectance0)*info.areaLightFresnel.y;',
};
const formula = (area) => ({ [`!${area.search.source}`]: area.replace, [`!${LIGHT_SPECULAR.search.source}`]: LIGHT_SPECULAR.replace });
const FORMULA = [formula(AREA_SPECULAR), formula(AREA_SPECULAR_WGSL)];

class BlenderAreaSpecularPlugin extends MaterialPluginBase {
  constructor(material) {
    super(material, NAME, 300, {}, true, true);
    // Bylonder's correction, not part of the material a Babylon file keeps.
    this.doNotSerialize = true;
  }
  getClassName() { return `${NAME}Plugin`; }
  isCompatible() { return true; }
  getCustomCode(shaderType, shaderLanguage = 0) { return shaderType === 'fragment' ? FORMULA[shaderLanguage] : null; }
}

// Gives a material of Blender's data EEVEE's light specular (once).
export function blenderAreaSpecular(material) {
  if (!material.pluginManager?.getPlugin(NAME)) new BlenderAreaSpecularPlugin(material);
  return material;
}
