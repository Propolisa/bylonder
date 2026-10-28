import { DefaultRenderingPipeline, ImageProcessingConfiguration, MotionBlurPostProcess, SSAO2RenderingPipeline, SSRRenderingPipeline } from '@babylonjs/core';

// Babylon adapter for render settings. The only code that writes scene.imageProcessingConfiguration
// tone mapping/exposure/contrast or creates render-engine effects. Effects are attached per camera, only to the
// cameras of views in Rendered shading or camera view (like EEVEE in Blender's viewport), so views with
// different shading render side by side without rebuilding anything.
// Effects that need scene geometry (Raytracing, Motion Blur) read Babylon's geometry buffer renderer, which renders
// for whichever camera the scene renders through, never its prepass renderer: the prepass is one scene-wide switch
// that routes every camera's draw into its targets, so views without these effects would never reach their canvas.
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
  const usesGeometry = effects => !!(effects.ssao || effects.ssr || effects.motion);
  const ownGeometryBuffer = !scene.geometryBufferRenderer;
  // The geometry buffer renders once per scene render; only cameras with effects that read it need it filled.
  const gateGeometryBuffer = scene.onBeforeRenderObservable.add(() => {
    const buffer = scene.geometryBufferRenderer, effects = attached.get(scene.activeCamera)?.effects;
    if (buffer && ownGeometryBuffer) buffer.renderList = effects && usesGeometry(effects) ? null : [];
  });
  const drop = camera => {
    const entry = attached.get(camera); if (!entry) return;
    const e = entry.effects; e.pipeline?.dispose(); e.ssr?.dispose(); e.ssao?.dispose(); e.motion?.dispose();
    attached.delete(camera);
    if (ownGeometryBuffer && ![...attached.values()].some(a => usesGeometry(a.effects))) scene.disableGeometryBufferRenderer();
  };
  const build = (camera, settings, samples) => {
    const e = settings.eevee, r = settings.render, effects = {};
    // Babylon's pipeline manager keys pipelines by name, so each camera's pipelines need their own.
    const name = id => `__${id}:${camera.uniqueId}`;
    if (samples > 1) { effects.pipeline = new DefaultRenderingPipeline(name('renderSamples'), false, scene, [camera]); effects.pipeline.imageProcessingEnabled = false; }
    // Post processes draw a view drawn into part of the canvas (views.js regions) on whole textures, so the geometry
    // buffer must fill whole textures too and Fast GI must not crop its result to the camera viewport.
    if (e.useRaytracing) effects.ssao = Object.assign(new SSAO2RenderingPipeline(name('fastGI'), scene, 0.5, [camera], true), { useViewportInCombineStage: false });
    if (e.useRaytracing && e.rayTracingMethod === 'SCREEN') effects.ssr = new SSRRenderingPipeline(name('screenTrace'), scene, [camera], true);
    if (r.useMotionBlur) effects.motion = new MotionBlurPostProcess(name('motionBlur'), scene, 1, camera, undefined, undefined, undefined, undefined, undefined, true);
    if (usesGeometry(effects)) scene.geometryBufferRenderer.getGBuffer().ignoreCameraViewport = true;
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
    dispose() { scene.onBeforeRenderObservable.remove(gateGeometryBuffer); for (const camera of [...attached.keys()]) drop(camera); },
  };
}
