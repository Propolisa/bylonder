// SPDX-License-Identifier: MIT OR Apache-2.0
// Override of Babylon's light defines: AREALIGHTUSED declared on every PBR and Standard material from the start, as Babylon adds it only when it rebuilds the defines' keys, so a light turned into an area light at an index a material drew before calls area light functions its includes left out; goes when Babylon rebuilds the keys for it.
import { AreaLight, MaterialPluginBase, PBRBaseMaterial, RegisterMaterialPlugin, StandardMaterial } from '@babylonjs/core';

// Of the lights the material draws (its first maxSimultaneousLights, none unlit), as Babylon defines and binds them.
export const usesAreaLights = (mesh, material) => !material.disableLighting && !!mesh?.getScene().lightsEnabled
  && !!mesh.lightSources?.slice(0, material.maxSimultaneousLights).some((light) => light instanceof AreaLight);
class BlenderAreaLightUsedPlugin extends MaterialPluginBase {
  constructor(material) {
    super(material, 'BlenderAreaLightUsed', 300, { AREALIGHTUSED: false }, true, true);
    this.doNotSerialize = true;
  }
  getClassName() { return 'BlenderAreaLightUsedPlugin'; }
  isCompatible() { return true; }
  prepareDefines(defines, scene, mesh) { defines.AREALIGHTUSED = usesAreaLights(mesh, this._material); }
}
RegisterMaterialPlugin('BlenderAreaLightUsed', (material) => (material instanceof PBRBaseMaterial || material instanceof StandardMaterial ? new BlenderAreaLightUsedPlugin(material) : null));
