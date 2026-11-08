// EEVEE's Dithered render method on a Principled BSDF drawn as a PBRMaterial: a surface Alpha lets through is hashed in
// the opaque pass, kept where its alpha passes the pixel's noise for the film's sample (render/dither.js), as a node
// material's Material Output does (nodes/blender/shader-nodes.js). Babylon's alpha test is the hashed test, through a
// material plugin's code replacement, and the shadow draws with the material's own shader (Babylon's
// ShadowDepthWrapper), so its samples average a shadow as dense as its coverage.
import { Material, MaterialPluginBase } from '@babylonjs/core';
import { SharedShadowDepthWrapper } from '../../draw/shadow-depth-wrapper.js';
import { DITHER_NOISE, ditherOffset } from '../../render/dither.js';

const NAME = 'BlenderDitheredPBR', DEFINE = 'BL_DITHERED_PBR', OFFSET = 'bl_dither_offset';
const CODE = {
  CUSTOM_FRAGMENT_DEFINITIONS: `uniform float ${OFFSET};
${DITHER_NOISE}
#ifdef ${DEFINE}
#define BL_ALPHA_DISCARDS(a) ((a) <= bl_dither(vPositionW, ${OFFSET}))
#else
#define BL_ALPHA_DISCARDS(a) ((a) < ALPHATESTVALUE)
#endif
`,
  '!if \\((\\w+(?:\\.alpha)?)<ALPHATESTVALUE\\)': 'if (BL_ALPHA_DISCARDS($1))',
};

class BlenderDitheredPBRPlugin extends MaterialPluginBase {
  constructor(material) {
    super(material, NAME, 310, { [DEFINE]: false }, true, false);
    // Bound at every draw (hardBindForSubMesh, one of Babylon's extra plugin events).
    Object.assign(this, { doNotSerialize: true, registerForExtraEvents: true });
    this._enable(true);
  }
  getClassName() { return `${NAME}Plugin`; }
  isCompatible(shaderLanguage) { return shaderLanguage === 0; }
  prepareDefines(defines, scene, mesh) { defines[DEFINE] = isDithered(this._material); }
  // Its own uniform, bound at every draw: Babylon's material cache skips a rebind between a frame's draws.
  getUniforms() { return { externalUniforms: [OFFSET] }; }
  hardBindForSubMesh(uniformBuffer, scene, engine, subMesh) { subMesh.effect?.setFloat(OFFSET, ditherOffset(scene)); }
  getCustomCode(shaderType) { return shaderType === 'fragment' ? CODE : null; }
}

const isDithered = (material) => !!material.blenderDithered && material.transparencyMode === Material.MATERIAL_ALPHATEST;

// Gives a material of Blender's data the Dithered render method's hashing where it is alpha tested as Dithered.
export function blenderDitheredPBR(material) {
  if (!material.pluginManager?.getPlugin(NAME)) new BlenderDitheredPBRPlugin(material);
  if (isDithered(material)) material.shadowDepthWrapper ??= new SharedShadowDepthWrapper(material, material.getScene());
  return material;
}
