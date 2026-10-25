import { DefaultRenderingPipeline, ImageProcessingConfiguration, MotionBlurPostProcess, SSAO2RenderingPipeline, SSRRenderingPipeline } from '@babylonjs/core';

// Babylon adapter for render settings. The only code that writes scene.imageProcessingConfiguration
// tone mapping/exposure/contrast or creates render-engine effects. Effects follow the active camera and
// exist only in Rendered shading and camera view, like EEVEE in Blender's viewport.
export const viewTransforms = {
  STANDARD: { label: 'Standard', apply: ip => { ip.toneMappingEnabled = false; } },
  KHR_PBR_NEUTRAL: { label: 'Khronos PBR Neutral', apply: ip => { ip.toneMappingEnabled = true; ip.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_KHR_PBR_NEUTRAL; } },
  ACES: { label: 'ACES', apply: ip => { ip.toneMappingEnabled = true; ip.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES; } },
  BABYLON_STANDARD: { label: 'Babylon Standard', apply: ip => { ip.toneMappingEnabled = true; ip.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_STANDARD; } },
};
// Blender's contrast looks, as Babylon image processing contrast.
export const looks = { NONE: ['None', 1], VERY_LOW_CONTRAST: ['Very Low Contrast', 0.6], LOW_CONTRAST: ['Low Contrast', 0.8], MEDIUM_LOW_CONTRAST: ['Medium Low Contrast', 0.9], MEDIUM_HIGH_CONTRAST: ['Medium High Contrast', 1.1], HIGH_CONTRAST: ['High Contrast', 1.2], VERY_HIGH_CONTRAST: ['Very High Contrast', 1.4] };

export function readAuthoredRender(scene) {
  const ip = scene.imageProcessingConfiguration;
  const viewTransform = !ip.toneMappingEnabled ? 'STANDARD' : ip.toneMappingType === ImageProcessingConfiguration.TONEMAPPING_ACES ? 'ACES' : ip.toneMappingType === ImageProcessingConfiguration.TONEMAPPING_KHR_PBR_NEUTRAL ? 'KHR_PBR_NEUTRAL' : 'BABYLON_STANDARD';
  const look = Object.entries(looks).find(([, [, c]]) => Math.abs(c - ip.contrast) < 1e-6)?.[0] || 'NONE';
  return { viewTransform, look, exposure: +Math.log2(Math.max(ip.exposure, 1e-6)).toFixed(6) };
}

export function createRenderEngine(scene) {
  let effects = null, key = '';
  const drop = () => { if (!effects) return; effects.pipeline?.dispose(); effects.ssr?.dispose(); effects.ssao?.dispose(); effects.motion?.dispose(); effects = null; key = ''; };
  return {
    render(settings, { rendered }) {
      const ip = scene.imageProcessingConfiguration, view = settings.viewSettings;
      viewTransforms[view.viewTransform].apply(ip);
      ip.exposure = 2 ** view.exposure;
      ip.contrast = looks[view.look][1];
      const camera = scene.activeCamera, e = settings.eevee, r = settings.render;
      const samples = Math.min(e.taaSamples, scene.getEngine().getCaps().maxMSAASamples || 1);
      const wanted = rendered && camera ? [camera.uniqueId, samples > 1, e.useRaytracing && e.rayTracingMethod === 'SCREEN', e.useRaytracing, r.useMotionBlur].join() : '';
      if (wanted !== key) {
        drop();
        if (wanted) {
          key = wanted; effects = {};
          if (samples > 1) { effects.pipeline = new DefaultRenderingPipeline('__renderSamples', false, scene, [camera]); effects.pipeline.imageProcessingEnabled = false; }
          if (e.useRaytracing) effects.ssao = new SSAO2RenderingPipeline('__fastGI', scene, 0.5, [camera]);
          if (e.useRaytracing && e.rayTracingMethod === 'SCREEN') effects.ssr = new SSRRenderingPipeline('__screenTrace', scene, [camera]);
          if (r.useMotionBlur) effects.motion = new MotionBlurPostProcess('__motionBlur', scene, 1, camera);
        }
      }
      if (!effects) return;
      if (effects.pipeline) effects.pipeline.samples = samples;
      if (effects.ssao) effects.ssao.radius = e.fastGiDistance;
      if (effects.ssr) Object.assign(effects.ssr, { thickness: e.screenTraceThickness, step: Math.max(1, Math.round(1 + (1 - e.screenTraceQuality) * 7)) });
      if (effects.motion) effects.motion.motionStrength = r.motionBlurShutter * 2;
    },
    dispose: drop,
  };
}
