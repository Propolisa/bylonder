// override(babylon): an area light's specular weighed as EEVEE's, and a punctual light's by its specular color, where
// Babylon squares a radiance-given light's intensity; goes when Babylon's formula matches EEVEE's. Blender-derived, so
// it stays outside src/overrides/ (MIT OR Apache-2.0). EEVEE (and LTC's authors) weigh the specular by the surface's F0
// and F90 over the split sum of the LTC lookup, times the light's color once; Babylon weighs the lookup by the color
// times the intensity and multiplies by it again, so a 365 W lamp 10 cm wide whites out a room. Put right through a
// material plugin's code replacement for a PBR material, and the include's replace strings for a node material's PBR
// block (nodes/blender/shader-nodes.js).
import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase.js';

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
const FORMULA = { [`!${AREA_SPECULAR.search.source}`]: AREA_SPECULAR.replace, [`!${LIGHT_SPECULAR.search.source}`]: LIGHT_SPECULAR.replace };

class BlenderAreaSpecularPlugin extends MaterialPluginBase {
  constructor(material) {
    super(material, NAME, 300, {}, true, true);
    // Bylonder's correction, not part of the material a Babylon file keeps.
    this.doNotSerialize = true;
  }
  getClassName() { return `${NAME}Plugin`; }
  isCompatible() { return true; }
  // GLSL: Bylonder's PBR materials compile from it on WebGPU too (overrides/webgpu/pbr-from-glsl.js).
  getCustomCode(shaderType, shaderLanguage = 0) { return shaderType === 'fragment' && shaderLanguage === 0 ? FORMULA : null; }
}

// Gives a material of Blender's data EEVEE's light specular (once).
export function blenderAreaSpecular(material) {
  if (!material.pluginManager?.getPlugin(NAME)) new BlenderAreaSpecularPlugin(material);
  return material;
}
