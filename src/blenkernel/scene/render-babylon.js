import { Camera, DefaultRenderingPipeline, DepthOfFieldEffectBlurLevel, ImageProcessingConfiguration, MotionBlurPostProcess, SSAO2RenderingPipeline, SSRRenderingPipeline } from '@babylonjs/core';
import { seededRandom } from '../../render/clock.js';
import { createFilm } from '../../render/film.js';

// Babylon adapter for render settings. The only code that writes scene.imageProcessingConfiguration
// tone mapping/exposure/contrast or creates render-engine effects. Effects are attached per camera, only to the
// cameras of views in Rendered shading (like EEVEE in Blender's viewport), so views with
// different shading render side by side without rebuilding anything.
// Effects that need scene geometry (Raytracing, Motion Blur) read Babylon's geometry buffer renderer, which renders
// for whichever camera the scene renders through, never its prepass renderer: the prepass is one scene-wide switch
// that routes every camera's draw into its targets, so views without these effects would never reach their canvas.
// `ocioView`: Blender's view transform (its OCIO config's view) nearest to each: Babylon's ACES is the fit of ACES 1's
// output transform, its Standard tone map a filmic curve.
export const viewTransforms = {
  STANDARD: { label: 'Standard', ocioView: 'Standard', apply: ip => { ip.toneMappingEnabled = false; } },
  KHR_PBR_NEUTRAL: { label: 'Khronos PBR Neutral', ocioView: 'Khronos PBR Neutral', apply: ip => { ip.toneMappingEnabled = true; ip.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_KHR_PBR_NEUTRAL; } },
  ACES: { label: 'ACES', ocioView: 'ACES 1.3', apply: ip => { ip.toneMappingEnabled = true; ip.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES; } },
  BABYLON_STANDARD: { label: 'Babylon Standard', ocioView: 'Filmic', apply: ip => { ip.toneMappingEnabled = true; ip.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_STANDARD; } },
};
// Blender's contrast looks, as Babylon image processing contrast.
export const looks = { NONE: ['None', 1], VERY_LOW_CONTRAST: ['Very Low Contrast', 0.6], LOW_CONTRAST: ['Low Contrast', 0.8], MEDIUM_LOW_CONTRAST: ['Medium Low Contrast', 0.9], MEDIUM_HIGH_CONTRAST: ['Medium High Contrast', 1.1], HIGH_CONTRAST: ['High Contrast', 1.2], VERY_HIGH_CONTRAST: ['Very High Contrast', 1.4] };
// A view transform or look as a .blend names it (Blender's OCIO names, AgX among them) or as Bylonder keys it; AgX,
// which Babylon lacks, takes the filmic curve nearest to it.
const OCIO_VIEWS = { AgX: 'BABYLON_STANDARD', 'Filmic Log': 'BABYLON_STANDARD', 'False Color': 'STANDARD', Raw: 'STANDARD' };
export const viewTransformOf = (name) => viewTransforms[name] ?? viewTransforms[OCIO_VIEWS[name] ?? Object.keys(viewTransforms).find((k) => viewTransforms[k].ocioView === name)] ?? viewTransforms.STANDARD;
const contrastOf = (look) => looks[look]?.[1] ?? Object.values(looks).find(([label]) => look?.endsWith(label))?.[1] ?? 1;

export function readAuthoredRender(scene) {
  const ip = scene.imageProcessingConfiguration;
  const viewTransform = !ip.toneMappingEnabled ? 'STANDARD' : ip.toneMappingType === ImageProcessingConfiguration.TONEMAPPING_ACES ? 'ACES' : ip.toneMappingType === ImageProcessingConfiguration.TONEMAPPING_KHR_PBR_NEUTRAL ? 'KHR_PBR_NEUTRAL' : 'BABYLON_STANDARD';
  const look = Object.entries(looks).find(([, [, c]]) => Math.abs(c - ip.contrast) < 1e-6)?.[0] || 'NONE';
  return { viewTransform, look, exposure: +Math.log2(Math.max(ip.exposure, 1e-6)).toFixed(6) };
}

// Babylon draws Fast GI's sample kernel and noise from Math.random; a fixed seed gives every view and every render
// the same pattern, so rendered images match the rendered viewport.
const withSeededRandom = create => {
  const random = Math.random;
  Math.random = seededRandom(1);
  try { return create(); } finally { Math.random = random; }
};

// The widest blur of Babylon's depth of field (its High level's kernel), in pixels.
const DOF_KERNEL = 51;

// dof(camera): its depth of field as Blender's camera has it ({ focusDistance in meters, fStop, lens in millimeters }), or null.
export function createRenderEngine(scene, { dof = () => null } = {}) {
  const attached = new Map(); // camera -> { key, effects }
  const usesGeometry = effects => !!(effects.ssao || effects.ssr || effects.motion);
  const ownGeometryBuffer = !scene.geometryBufferRenderer;
  // The geometry buffer renders per camera; only cameras with effects that read it need it filled. A camera observer
  // leaves the scene's render observers to user code, which keeps the views rendering (main.js).
  const gateGeometryBuffer = scene.onBeforeCameraRenderObservable.add((camera) => {
    const buffer = scene.geometryBufferRenderer, effects = attached.get(camera)?.effects;
    if (buffer && ownGeometryBuffer) buffer.renderList = effects && usesGeometry(effects) ? null : [];
  });
  // Blender's depth of field on a camera that has it (EEVEE draws it through the camera and in renders) as Babylon's,
  // its circle of confusion in pixels as Blender's: a millimeter of it on the sensor is the focal length in pixels over
  // the lens's, which the blur's widest kernel spans.
  const focus = scene.onBeforeCameraRenderObservable.add((camera) => {
    const pipeline = attached.get(camera)?.effects.pipeline;
    if (!pipeline) return;
    const settings = camera.mode === Camera.PERSPECTIVE_CAMERA ? dof(camera) : null;
    if (pipeline.depthOfFieldEnabled !== !!settings) pipeline.depthOfFieldEnabled = !!settings;
    if (!settings) return;
    const focalPixels = camera.getProjectionMatrix().m[0] * scene.getEngine().getRenderWidth() * camera.viewport.width / 2;
    Object.assign(pipeline.depthOfField, { focusDistance: settings.focusDistance * 1000, fStop: settings.fStop, focalLength: settings.lens, lensSize: focalPixels / DOF_KERNEL });
  });
  const drop = camera => {
    const entry = attached.get(camera); if (!entry) return;
    const e = entry.effects; e.pipeline?.dispose(); e.ssr?.dispose(); e.ssao?.dispose(); e.motion?.dispose(); e.film.dispose();
    attached.delete(camera);
    if (ownGeometryBuffer && ![...attached.values()].some(a => usesGeometry(a.effects))) scene.disableGeometryBufferRenderer();
  };
  let viewportSamples = 1;
  const build = (camera, settings) => {
    const e = settings.eevee, r = settings.render, effects = {};
    // EEVEE's film first: the samples a view accumulates (its viewport samples) in scene linear.
    effects.film = Object.assign(createFilm(scene, camera), { samples: () => viewportSamples });
    // Babylon's pipeline manager keys pipelines by name, so each camera's pipelines need their own.
    const name = id => `__${id}:${camera.uniqueId}`;
    // Drawn in half float, displayed by its image processing: the view transform, after blending, as Blender's.
    effects.pipeline = new DefaultRenderingPipeline(name('display'), true, scene, [camera]);
    effects.pipeline.depthOfFieldBlurLevel = DepthOfFieldEffectBlurLevel.High;
    // Post processes draw a view drawn into part of the canvas (views.js regions) on whole textures, so the geometry
    // buffer must fill whole textures too and Fast GI must not crop its result to the camera viewport.
    if (e.useRaytracing) effects.ssao = Object.assign(withSeededRandom(() => new SSAO2RenderingPipeline(name('fastGI'), scene, 0.5, [camera], true)), { useViewportInCombineStage: false });
    if (e.useRaytracing && e.rayTracingMethod === 'SCREEN') effects.ssr = new SSRRenderingPipeline(name('screenTrace'), scene, [camera], true);
    if (r.useMotionBlur) effects.motion = new MotionBlurPostProcess(name('motionBlur'), scene, 1, camera, undefined, undefined, undefined, undefined, undefined, true);
    if (usesGeometry(effects) && scene.geometryBufferRenderer) scene.geometryBufferRenderer.getGBuffer().ignoreCameraViewport = true;
    return effects;
  };
  return {
    // cameras: the cameras of rendered views (iterable). Called when settings or view shading change, not per frame.
    render(settings, { cameras = [] } = {}) {
      const ip = scene.imageProcessingConfiguration, view = settings.viewSettings;
      viewTransformOf(view.viewTransform).apply(ip);
      ip.exposure = 2 ** view.exposure;
      ip.contrast = contrastOf(view.look);
      const e = settings.eevee, r = settings.render;
      viewportSamples = Math.max(1, Math.round(e.taaSamples));
      const wanted = new Set([...cameras].filter(c => c && !c.isDisposed?.()));
      for (const camera of [...attached.keys()]) if (!wanted.has(camera)) drop(camera);
      const key = [e.useRaytracing && e.rayTracingMethod === 'SCREEN', e.useRaytracing, r.useMotionBlur].join();
      for (const camera of wanted) {
        if (attached.get(camera)?.key !== key) { drop(camera); attached.set(camera, { key, effects: build(camera, settings) }); }
        const effects = attached.get(camera).effects;
        effects.film.reset();
        if (effects.ssao) effects.ssao.radius = e.fastGiDistance;
        if (effects.ssr) Object.assign(effects.ssr, { thickness: e.screenTraceThickness, step: Math.max(1, Math.round(1 + (1 - e.screenTraceQuality) * 7)) });
        if (effects.motion) effects.motion.motionStrength = r.motionBlurShutter * 2;
      }
    },
    // A rendered camera's film (film.js), and every film started again (Main evaluated something new).
    film: (camera) => attached.get(camera)?.effects.film ?? null,
    resetFilms() { for (const { effects } of attached.values()) effects.film.reset(); },
    setSceneLinear(value) { scene.imageProcessingConfiguration.applyByPostProcess = value; },
    dispose() { scene.onBeforeCameraRenderObservable.remove(gateGeometryBuffer); scene.onBeforeCameraRenderObservable.remove(focus); for (const camera of [...attached.keys()]) drop(camera); },
  };
}
