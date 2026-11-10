// EEVEE's light probes on a Principled BSDF drawn as a PBRMaterial (principled-gltf.js), as a node material's
// reflection block takes them (nodes/blender/shader-nodes.js BlenderReflectionBlock): the volume probes' irradiance in
// place of the environment's, the environment's reflection scaled by the light around the point, and a probe's capture
// (light-probes.js) drawing the surface as a surfel sees it. Babylon's own extension point: a material plugin's code.
import { MaterialPluginBase } from '@babylonjs/core';
import { ditherOffset } from '../render/dither.js';
import { guardedDefinitions } from '../nodes/blender/glsl.js';
import { probeAmbient, probeCapture, volumeProbeTextures } from './light-probes.js';
import { ATLAS, CAPTURE, DEFINE, GRIDS, SAMPLERS, volumeProbeFunctions, volumeProbeLambert, volumeProbeSample } from './volume-probe-shader.js';

const NAME = 'BlenderLightProbes', SINGLE_SIDED = 'BL_PROBE_SINGLE_SIDED';
const OFFSET = 'blProbeOffset', CLAMP = 'blProbeClamp', AMBIENT = 'blProbeAmbient', EYE = 'blProbeEye';
const UNIFORMS = [[OFFSET, 'float', 1], [CLAMP, 'vec2', 2], [EYE, 'vec3', 3], [AMBIENT, 'float', 1]];

let code = null;
const customCode = () => code ??= {
  CUSTOM_FRAGMENT_DEFINITIONS: `#ifdef ${DEFINE}
${SAMPLERS}#endif
${guardedDefinitions(volumeProbeFunctions())}
float bl_probe_capture_visibility = 0.0;
vec3 bl_probe_clamp(vec3 radiance, float limit) {
  float luma = max(1e-8, max(radiance.r, max(radiance.g, radiance.b)));
  return radiance * (1.0 - max(0.0, luma - limit) / luma);
}
`,
  // After the reflection block, as BlenderReflectionBlock's code follows Babylon's.
  '!(#define CUSTOM_REFLECTION\\s*#endif\\s*#endif)': `$1
#if defined(REFLECTION) && defined(${DEFINE})
BlProbeSH blProbeSH = ${volumeProbeSample('vPositionW', 'normalW', 'viewDirectionW', OFFSET)};
vec4 blProbe = ${volumeProbeLambert('blProbeSH', 'normalW')};
reflectionOut.environmentIrradiance = blProbe.rgb * vReflectionColor.rgb;
reflectionOut.environmentRadiance.rgb *= bl_probe_normalization(blProbeSH, ${AMBIENT});
#ifdef ${CAPTURE}
bl_probe_capture_visibility = blProbe.a;
#endif
#endif
`,
  // blender-port: eevee_surfel_light.bsl.hh, eevee_surfel_ray.bsl.hh radiance_transfer: as BlenderSurfaceBlock
  // _probeCaptureLit and ShaderNodeOutputMaterial _probeCaptureOutput draw a capture.
  CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR: `#ifdef ${CAPTURE}
finalColor.rgb = bl_probe_clamp(finalDiffuse, ${CLAMP}.x) + finalEmissive;
#ifdef REFLECTION
finalColor.rgb += bl_probe_clamp(finalIrradiance, ${CLAMP}.y);
#endif
float blCaptureAlpha = dot(surfaceAlbedo.rgb, vec3(1.0 / 3.0)) * bl_probe_capture_visibility;
#ifdef ${SINGLE_SIDED}
finalColor = dot(vNormalW, ${EYE} - vPositionW) >= 0.0 ? vec4(finalColor.rgb, blCaptureAlpha) : vec4(0.0, 0.0, 0.0, -1.0);
#else
finalColor.a = blCaptureAlpha;
#endif
#endif
`,
};

class BlenderLightProbesPlugin extends MaterialPluginBase {
  constructor(material) {
    super(material, NAME, 320, { [DEFINE]: false, [CAPTURE]: false, [SINGLE_SIDED]: false }, true, false);
    // Bound at every draw: Babylon's material cache skips a rebind between a frame's draws, and a capture draws apart.
    Object.assign(this, { doNotSerialize: true, registerForExtraEvents: true });
    this._enable(true);
  }
  getClassName() { return `${NAME}Plugin`; }
  // WebGPU's WGSL PBR takes no probes: their code is GLSL, for Babylon's GLSL PBR on both engines.
  isCompatible() { return true; }
  prepareDefines(defines, scene) {
    const capture = probeCapture(scene);
    defines[CAPTURE] = !!capture;
    defines[DEFINE] = !!volumeProbeTextures(scene, capture);
    // Material > Settings > Backface Culling > Light Probe Volume (main-view.js drawShading).
    defines[SINGLE_SIDED] = this._material.blenderProbeBackfaceCulling ?? true;
  }
  getSamplers(samplers) { samplers.push(ATLAS, GRIDS); }
  // In the material's uniform block (no uniform buffer of their own, of the 12 a WebGPU stage may have).
  getUniforms() {
    return { ubo: UNIFORMS.map(([name, type, size]) => ({ name, type, size })), fragment: UNIFORMS.map(([name, type]) => `uniform ${type} ${name};`).join('\n') };
  }
  hardBindForSubMesh(uniformBuffer, scene, engine, subMesh) {
    const effect = subMesh.effect, capture = probeCapture(scene), textures = volumeProbeTextures(scene, capture);
    if (!effect || !textures || this._material.shaderLanguage !== 0) return;
    effect.setTexture(ATLAS, textures.atlas);
    effect.setTexture(GRIDS, textures.grids);
    uniformBuffer.updateFloat(OFFSET, ditherOffset(scene));
    uniformBuffer.updateFloat(AMBIENT, probeAmbient(scene, this._material.reflectionTexture ?? scene.environmentTexture));
    if (capture) { uniformBuffer.updateFloat2(CLAMP, capture.clampDirect, capture.clampIndirect); uniformBuffer.updateVector3(EYE, capture.eye); }
  }
  getCustomCode(shaderType, shaderLanguage = 0) { return shaderType === 'fragment' && shaderLanguage === 0 ? customCode() : null; }
}

// Gives a material of Blender's data EEVEE's light probes (once).
export function blenderLightProbes(material) {
  if (!material.pluginManager?.getPlugin(NAME)) new BlenderLightProbesPlugin(material);
  return material;
}
