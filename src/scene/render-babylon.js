import { DefaultRenderingPipeline, ImageProcessingConfiguration, MotionBlurPostProcess, SSAO2RenderingPipeline, SSRRenderingPipeline } from '@babylonjs/core';

// Babylon adapter for render settings. The only code that writes scene.imageProcessingConfiguration
// tone mapping/exposure/contrast or creates render-engine effects. Effects are attached per camera, only to the
// cameras of views in Rendered shading or camera view (like EEVEE in Blender's viewport), so views with
// different shading render side by side without rebuilding anything.
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
  const attached = new Map(); // camera -> { key, effects }
  const drop = camera => {
    const entry = attached.get(camera); if (!entry) return;
    const e = entry.effects; e.pipeline?.dispose(); e.ssr?.dispose(); e.ssao?.dispose(); e.motion?.dispose();
    attached.delete(camera);
  };
  const build = (camera, settings, samples) => {
    const e = settings.eevee, r = settings.render, effects = {};
    if (samples > 1) { effects.pipeline = new DefaultRenderingPipeline('__renderSamples', false, scene, [camera]); effects.pipeline.imageProcessingEnabled = false; }
    if (e.useRaytracing) effects.ssao = new SSAO2RenderingPipeline('__fastGI', scene, 0.5, [camera]);
    if (e.useRaytracing && e.rayTracingMethod === 'SCREEN') effects.ssr = new SSRRenderingPipeline('__screenTrace', scene, [camera]);
    if (r.useMotionBlur) effects.motion = new MotionBlurPostProcess('__motionBlur', scene, 1, camera);
    return effects;
  };
  return {
    // cameras: the cameras of rendered views (iterable). Called when settings or view shading change, not per frame.
    render(settings, { cameras = [] } = {}) {
      const ip = scene.imageProcessingConfiguration, view = settings.viewSettings;
      viewTransforms[view.viewTransform].apply(ip);
      ip.exposure = 2 ** view.exposure;
      ip.contrast = looks[view.look][1];
      const e = settings.eevee, r = settings.render;
      const samples = Math.min(e.taaSamples, scene.getEngine().getCaps().maxMSAASamples || 1);
      const wanted = new Set([...cameras].filter(c => c && !c.isDisposed?.()));
      for (const camera of [...attached.keys()]) if (!wanted.has(camera)) drop(camera);
      const key = [samples > 1, e.useRaytracing && e.rayTracingMethod === 'SCREEN', e.useRaytracing, r.useMotionBlur].join();
      for (const camera of wanted) {
        if (attached.get(camera)?.key !== key) { drop(camera); attached.set(camera, { key, effects: build(camera, settings, samples) }); }
        const effects = attached.get(camera).effects;
        if (effects.pipeline) effects.pipeline.samples = samples;
        if (effects.ssao) effects.ssao.radius = e.fastGiDistance;
        if (effects.ssr) Object.assign(effects.ssr, { thickness: e.screenTraceThickness, step: Math.max(1, Math.round(1 + (1 - e.screenTraceQuality) * 7)) });
        if (effects.motion) effects.motion.motionStrength = r.motionBlurShutter * 2;
      }
    },
    dispose() { for (const camera of [...attached.keys()]) drop(camera); },
  };
}
