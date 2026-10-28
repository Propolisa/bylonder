import { Color3, Color4, CubeTexture, HDRCubeTexture, Scene } from '@babylonjs/core';

// Babylon adapter for a World datablock. Babylon has no World object, so a world is pushed into
// scene.clearColor, environmentTexture/environmentIntensity, a skybox and fog. Nothing else touches these.
export const fogModes = { NONE: Scene.FOGMODE_NONE, SCATTER: Scene.FOGMODE_EXP, EXP2: Scene.FOGMODE_EXP2, LINEAR: Scene.FOGMODE_LINEAR };
const rgb = color => [color.r, color.g, color.b].map(v => +v.toFixed(6));

// Reads what the code-built scene set up, as World fields.
export function readAuthoredWorld(scene, defaults) {
  const texture = scene.environmentTexture, skyboxes = scene.meshes.filter(m => m.infiniteDistance && !m.name.startsWith('__'));
  return {
    background: texture
      ? { ...defaults.background, input: 'ENVIRONMENT', image: 'scene', color: rgb(scene.clearColor), strength: scene.environmentIntensity, rotation: texture.rotationY || 0 }
      : { ...defaults.background, input: 'COLOR', color: rgb(scene.clearColor) },
    volume: { type: Object.entries(fogModes).find(([, mode]) => mode === scene.fogMode)?.[0] || 'NONE', color: rgb(scene.fogColor), density: scene.fogDensity, start: scene.fogStart, end: scene.fogEnd },
    visibility: { camera: texture ? skyboxes.some(m => m.isEnabled(false)) : true },
  };
}

export function createWorldRenderer(scene, { asset = path => path, studio } = {}) {
  const authoredTexture = scene.environmentTexture;
  const authoredSkyboxes = scene.meshes.filter(m => m.infiniteDistance && !m.name.startsWith('__'));
  const textures = new Map(authoredTexture ? [['scene', authoredTexture]] : []);
  let skybox = null, skyboxKey = '', rendered = false, useAuthored = false;
  const texture = key => {
    if (!key) return null;
    if (!textures.has(key)) {
      const url = /^https?:/.test(key) ? key : asset(key);
      const tex = /\.hdr$/i.test(key) ? new HDRCubeTexture(url, scene, 256) : CubeTexture.CreateFromPrefilteredData(url, scene);
      tex.name = key;
      textures.set(key, tex);
    }
    return textures.get(key);
  };
  // The world's background and volume show only where a view is rendered. Content (skybox, fog settings) is
  // built once per world change; gate() only flips visibility, so views with different shading can alternate
  // every frame at no cost.
  const gate = () => {
    authoredSkyboxes.forEach(mesh => mesh.setEnabled(useAuthored && rendered));
    skybox?.setEnabled(rendered);
    scene.fogEnabled = rendered;
  };
  const setSkybox = (key, tex, background) => {
    useAuthored = !!tex && key === 'scene' && authoredSkyboxes.length > 0;
    if (!tex || useAuthored || skyboxKey !== key) { skybox?.dispose(false, true); skybox = null; skyboxKey = ''; }
    if (!tex || useAuthored) return;
    if (!skybox) {
      skybox = scene.createDefaultSkybox(tex, true, 1000, 0, false);
      Object.assign(skybox, { name: '__worldSkybox', isPickable: false, applyFog: false, doNotSerialize: true, metadata: { editable: false } });
      skyboxKey = key;
    }
    skybox.material.reflectionTexture.rotationY = background.rotation;
    skybox.material.environmentIntensity = background.strength;
  };
  // Material Preview (Blender's default: the studio light as environment and background, blurred at 0.5, with neither
  // the scene's lights nor its world). port-override: Babylon's studio environment stands in for Blender's forest.exr.
  let preview = null, previewSkybox = null;
  const setPreview = (value) => {
    if (!!preview === value) return;
    if (value) {
      const env = texture(studio);
      preview = { env: scene.environmentTexture, intensity: scene.environmentIntensity, lights: scene.lights.map((light) => [light, light.intensity]) };
      scene.environmentTexture = env;
      scene.environmentIntensity = 1;
      for (const [light] of preview.lights) light.intensity = 0;
      if (!previewSkybox || previewSkybox.isDisposed()) {
        previewSkybox = scene.createDefaultSkybox(env, true, 1000, 0.5, false);
        Object.assign(previewSkybox, { name: '__previewSkybox', isPickable: false, applyFog: false, doNotSerialize: true, metadata: { editable: false } });
      }
      previewSkybox.setEnabled(true);
    } else {
      scene.environmentTexture = preview.env;
      scene.environmentIntensity = preview.intensity;
      for (const [light, intensity] of preview.lights) light.intensity = intensity;
      previewSkybox?.setEnabled(false);
      preview = null;
    }
  };
  return {
    hasAuthoredTexture: !!authoredTexture,
    // Material Preview for the view about to render, and off after it. Cheap; called per view.
    setPreview,
    // Rebuilds the world's Babylon state. Solid and Wireframe views show no world background or volume, as in Blender.
    render(world) {
      const background = world?.background, volume = world?.volume;
      const env = background?.input === 'ENVIRONMENT' ? texture(background.image) : null;
      if (env) env.rotationY = background.rotation;
      scene.environmentTexture = env;
      scene.environmentIntensity = env ? background.strength : 1;
      const color = background ? background.color.map(v => v * (env ? 1 : background.strength)) : [0, 0, 0];
      scene.clearColor = new Color4(...color.map(v => Math.min(1, v)), 1);
      setSkybox(background?.image, env && world.visibility.camera ? env : null, background);
      scene.fogMode = volume ? fogModes[volume.type] : Scene.FOGMODE_NONE;
      if (volume) Object.assign(scene, { fogColor: Color3.FromArray(volume.color), fogDensity: volume.density, fogStart: volume.start, fogEnd: volume.end });
      gate();
    },
    // Rendered shading or camera view for the view about to render. Cheap; called per view.
    setRendered(value) { if (rendered !== value) { rendered = value; gate(); } },
    dispose() {
      skybox?.dispose(false, true);
      previewSkybox?.dispose(false, true);
      for (const [key, tex] of textures) if (key !== 'scene') tex.dispose();
    },
  };
}
