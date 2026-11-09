// An area light's specular as EEVEE's (and LTC's authors') weighs it: the surface's F0 and F90 over the split sum of the
// LTC lookup, times the light's color once. Babylon's own formula weighs the lookup by the light's color times its
// intensity, and then multiplies by it again, so a light given in radiance (Blender's power over its area, large for a
// small light) shines its intensity squared: a 365 W lamp 10 cm wide whites out a room. The formula is put right in the
// materials of Blender's data through Babylon's own extension points: a material plugin's code replacement for a PBR
// material, the include's replace strings for a node material's PBR block (nodes/blender/shader-nodes.js).
import { AreaLight, MaterialPluginBase, PBRBaseMaterial, RegisterMaterialPlugin, StandardMaterial } from '@babylonjs/core';

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
  // GLSL: Bylonder's PBR materials compile from it on WebGPU too (gpu-engine.js materialsFromGLSL).
  getCustomCode(shaderType, shaderLanguage = 0) { return shaderType === 'fragment' && shaderLanguage === 0 ? FORMULA : null; }
}

// A light turned into an area light at an index a material drew before defines AREALIGHT{X} but not AREALIGHTUSED,
// which Babylon adds only when it rebuilds the defines' keys, so the light's code calls area light functions the
// material's includes left out and the shader does not compile. The key is there from the start here.
// On WebGPU, PBR's area light function takes the LTC samplers as arguments, which WebGPU's GLSL does not: Babylon's
// WebGPU engine inlines the functions marked `#define inline` (ShaderCodeInliner), sampling their arguments in place,
// and this one is marked here (and in a node material's PBR block, nodes/blender/shader-nodes.js).
export const AREA_PRE_LIGHTING = { search: /preLightingInfo computeAreaPreLightingInfo\(/, replace: '\n#define inline\n$&' };
const INLINE_AREA = { [`!${AREA_PRE_LIGHTING.search.source}`]: AREA_PRE_LIGHTING.replace };
// Of the lights the material draws (its first maxSimultaneousLights, none unlit), as Babylon defines and binds them.
export const usesAreaLights = (mesh, material) => !material.disableLighting && !!mesh?.getScene().lightsEnabled
  && !!mesh.lightSources?.slice(0, material.maxSimultaneousLights).some((light) => light instanceof AreaLight);
class BlenderAreaLightsPlugin extends MaterialPluginBase {
  constructor(material) {
    super(material, 'BlenderAreaLights', 300, { AREALIGHTUSED: false }, true, true);
    this.doNotSerialize = true;
  }
  getClassName() { return 'BlenderAreaLightsPlugin'; }
  isCompatible() { return true; }
  prepareDefines(defines, scene, mesh) { defines.AREALIGHTUSED = usesAreaLights(mesh, this._material); }
  getCustomCode(shaderType, shaderLanguage = 0) {
    const inline = this._material instanceof PBRBaseMaterial && this._material.getScene().getEngine().isWebGPU && shaderLanguage === 0;
    return shaderType === 'fragment' && inline ? INLINE_AREA : null;
  }
}
RegisterMaterialPlugin('BlenderAreaLights', (material) => (material instanceof PBRBaseMaterial || material instanceof StandardMaterial ? new BlenderAreaLightsPlugin(material) : null));

// Gives a material of Blender's data EEVEE's light specular (once).
export function blenderAreaSpecular(material) {
  if (!material.pluginManager?.getPlugin(NAME)) new BlenderAreaSpecularPlugin(material);
  return material;
}
