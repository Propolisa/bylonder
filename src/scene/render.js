import { createRenderEngine, readAuthoredRender } from './render-babylon.js';

// Render settings of the Scene, shaped like Blender's scene.render, scene.eevee, scene.view_settings and
// scene.display_settings. Document slice "render"; saved as a diff from the code-built scene.
// Post effects Blender does in the compositor (bloom/glare, vignette, grain) belong to the Compositor, not here.
export const renderDefaults = {
  render: {
    engine: 'BABYLON', useMotionBlur: false, motionBlurShutter: 0.5,
    // Output properties (Blender: Properties > Output, scene.render.*)
    resolutionX: 1920, resolutionY: 1080, resolutionPercentage: 100,
    imageSettings: { fileFormat: 'PNG', quality: 90 },
    ffmpeg: { format: 'MPEG4', codec: 'H264', constantRateFactor: 'MEDIUM', gopsize: 18 },
    // Post Processing > Sequencer: with strips in the edit, renders output the edit instead of the camera.
    useSequencer: true,
  },
  eevee: { taaSamples: 1, taaRenderSamples: 16, useRaytracing: false, rayTracingMethod: 'SCREEN', screenTraceQuality: 0.25, screenTraceThickness: 0.5, fastGiMethod: 'AMBIENT_OCCLUSION', fastGiDistance: 2 },
  viewSettings: { viewTransform: 'STANDARD', look: 'NONE', exposure: 0 },
  displaySettings: { displayDevice: 'sRGB' },
};
// Animatable render properties, as paths relative to the scene (Blender: scene.view_settings.exposure etc.).
export const renderChannels = [['viewSettings.exposure', 'Exposure'], ['render.motionBlurShutter', 'Shutter'], ['eevee.screenTraceThickness', 'Thickness'], ['eevee.fastGiDistance', 'Fast GI Distance']];
const clone = value => JSON.parse(JSON.stringify(value));
const resolve = (state, path) => { const keys = path.split('.'), key = keys.pop(); return { owner: keys.reduce((o, k) => o?.[k], state), key }; };
export const getRenderPath = (state, path) => { const { owner, key } = resolve(state, path); return owner?.[key]; };
// Output size in pixels: resolution times percentage, like Blender's render size.
export const outputSize = render => ({ width: Math.max(4, Math.round(render.resolutionX * render.resolutionPercentage / 100)), height: Math.max(4, Math.round(render.resolutionY * render.resolutionPercentage / 100)) });

export function createRenderSettings(world, { commit = () => {} } = {}) {
  const { scene, animation } = world;
  const listeners = new Set();
  const emit = () => listeners.forEach(fn => fn());
  const engine = createRenderEngine(scene);
  let cameras = new Set();
  const baseline = { ...clone(renderDefaults), viewSettings: { ...renderDefaults.viewSettings, ...readAuthoredRender(scene) } };
  let state = clone(baseline);
  const render = () => engine.render(state, { cameras });
  for (const [path, label] of renderChannels) animation.register({ id: 'scene', path, label, group: 'Scene', get: () => getRenderPath(state, path), set: v => { const { owner, key } = resolve(state, path); owner[key] = v; render(); } });
  render();
  return {
    get state() { return state; },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    // Cameras of the views in Rendered shading or camera view; render effects attach to these only.
    setRenderedCameras(list) { const next = new Set(list); if (next.size === cameras.size && [...next].every(c => cameras.has(c))) return; cameras = next; render(); },
    set(path, value, finish = true) {
      const { owner, key } = resolve(state, path);
      owner[key] = value; render();
      if (finish) { emit(); commit(); }
    },
    capture() {
      const out = Object.fromEntries(Object.keys(baseline).map(k => [k, Object.fromEntries(Object.entries(state[k]).filter(([f, v]) => JSON.stringify(v) !== JSON.stringify(baseline[k][f])))]).filter(([, v]) => Object.keys(v).length));
      return Object.keys(out).length ? clone(out) : undefined;
    },
    apply(saved = {}) {
      const next = Object.fromEntries(Object.keys(baseline).map(k => [k, { ...clone(baseline[k]), ...saved[k] }]));
      if (JSON.stringify(next) === JSON.stringify(state)) return;
      state = next; render(); emit();
    },
    dispose() { engine.dispose(); listeners.clear(); },
  };
}
