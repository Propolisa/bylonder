// SPDX-License-Identifier: MIT OR Apache-2.0
// Override of Babylon's PBR shader on WebGPU: its area light function, which takes the LTC samplers as arguments that WebGPU's GLSL does not take, marked `#define inline` so Babylon's WebGPU engine inlines it (ShaderCodeInliner), sampling them in place (a node material's PBR block marks it with AREA_PRE_LIGHTING too); goes when Babylon marks it.
import { MaterialPluginBase, PBRBaseMaterial, RegisterMaterialPlugin } from '@babylonjs/core';

export const AREA_PRE_LIGHTING = { search: /preLightingInfo computeAreaPreLightingInfo\(/, replace: '\n#define inline\n$&' };
const INLINE_AREA = { [`!${AREA_PRE_LIGHTING.search.source}`]: AREA_PRE_LIGHTING.replace };
class BlenderAreaLightInlinePlugin extends MaterialPluginBase {
  constructor(material) {
    super(material, 'BlenderAreaLightInline', 300, {}, true, true);
    this.doNotSerialize = true;
  }
  getClassName() { return 'BlenderAreaLightInlinePlugin'; }
  isCompatible() { return true; }
  getCustomCode(shaderType, shaderLanguage = 0) { return shaderType === 'fragment' && shaderLanguage === 0 ? INLINE_AREA : null; }
}
RegisterMaterialPlugin('BlenderAreaLightInline', (material) => (material instanceof PBRBaseMaterial && material.getScene().getEngine().isWebGPU ? new BlenderAreaLightInlinePlugin(material) : null));
