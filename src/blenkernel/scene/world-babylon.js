import { Color3, Color4, CubeTexture, HDRCubeTexture, HemisphericLight, Scene, Vector3 } from '@babylonjs/core';

// Babylon adapter for a World datablock. Babylon has no World object, so a world is pushed into
// scene.clearColor, environmentTexture/environmentIntensity, a skybox and fog. Nothing else touches these.
export const fogModes = { NONE: Scene.FOGMODE_NONE, SCATTER: Scene.FOGMODE_EXP, EXP2: Scene.FOGMODE_EXP2, LINEAR: Scene.FOGMODE_LINEAR };
const rgb = color => [color.r, color.g, color.b].map(v => +v.toFixed(6));
const linear = color => rgb(new Color3(color.r, color.g, color.b).toLinearSpace());

// Reads what the code-built scene set up, as World fields: a world Blender's (createWorld), or Babylon's clear color.
export function readAuthoredWorld(scene, defaults) {
  const texture = scene.environmentTexture, skyboxes = scene.meshes.filter(m => m.infiniteDistance && !m.name.startsWith('__'));
  const blender = scene.metadata?.wbWorld;
  return {
    home: blender ? defaults.home : 'BABYLON',
    background: texture
      ? { ...defaults.background, input: 'ENVIRONMENT', image: 'scene', color: linear(scene.clearColor), strength: scene.environmentIntensity, rotation: texture.rotationY || 0 }
      : { ...defaults.background, input: 'COLOR', color: blender?.color ?? linear(scene.clearColor) },
    volume: { type: Object.entries(fogModes).find(([, mode]) => mode === scene.fogMode)?.[0] || 'NONE', color: rgb(scene.fogColor), density: scene.fogDensity, start: scene.fogStart, end: scene.fogEnd },
    visibility: { camera: texture ? skyboxes.some(m => m.isEnabled(false)) : true },
  };
}

export function createWorldRenderer(scene, { asset = path => path, studio } = {}) {
  const authoredTexture = scene.environmentTexture;
  const authoredSkyboxes = scene.meshes.filter(m => m.infiniteDistance && !m.name.startsWith('__'));
  const textures = new Map(authoredTexture ? [['scene', authoredTexture]] : []);
  let skybox = null, skyboxKey = '', rendered = false, useAuthored = false;
  // A world color lights everything evenly in Blender: a hemispheric light with equal sky and ground gives each
  // surface its albedo times it. Switched by intensity, not enabled state, which would recompile materials per view.
  const worldLight = Object.assign(new HemisphericLight('__worldLight', Vector3.Up(), scene), { specular: Color3.Black(), intensity: 0, doNotSerialize: true, metadata: { editable: false } });
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
    worldLight.intensity = rendered ? 1 : 0;
    scene.fogEnabled = rendered;
  };
  // The scene's own sky meshes show for its own world: lit by its environment, or without one (a shader sky).
  const setSkybox = (key, tex, background, authoredWorld) => {
    useAuthored = authoredSkyboxes.length > 0 && (tex ? key === 'scene' : authoredWorld);
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
  // Set when shading changes, not per view: switching the environment or lights recompiles materials. The scene's
  // lights are left out by a layer no mesh is on, which leaves their settings as they are.
  const NO_MESH_LAYER = 0x10000000;
  let preview = null, previewSkybox = null;
  const applyPreview = () => {
    const env = texture(studio);
    scene.environmentTexture = env;
    scene.environmentIntensity = 1;
    for (const light of scene.lights) if (!preview.lights.has(light)) { preview.lights.set(light, light.includeOnlyWithLayerMask); light.includeOnlyWithLayerMask = NO_MESH_LAYER; }
    if (!previewSkybox || previewSkybox.isDisposed()) {
      previewSkybox = scene.createDefaultSkybox(env, true, 1000, 0.5, false);
      Object.assign(previewSkybox, { name: '__previewSkybox', isPickable: false, applyFog: false, doNotSerialize: true, metadata: { editable: false } });
      previewSkybox.setEnabled(false);
    }
  };
  const setPreview = (value) => {
    if (!!preview === value) return;
    if (value) {
      preview = { env: scene.environmentTexture, intensity: scene.environmentIntensity, lights: new Map() };
      applyPreview();
      return;
    }
    scene.environmentTexture = preview.env;
    scene.environmentIntensity = preview.intensity;
    for (const [light, mask] of preview.lights) light.includeOnlyWithLayerMask = mask;
    previewSkybox?.setEnabled(false);
    preview = null;
  };
  return {
    hasAuthoredTexture: !!authoredTexture,
    // Material Preview's lighting for the scene, while a view shows it.
    setPreview,
    // Its background, for the view about to render. Cheap; called per view.
    showPreview(value) { previewSkybox?.setEnabled(!!preview && value); },
    // Rebuilds the world's Babylon state. Solid and Wireframe views show no world background or volume, as in Blender.
    render(world) {
      const background = world?.background, volume = world?.volume;
      const env = background?.input === 'ENVIRONMENT' ? texture(background.image) : null;
      if (env) env.rotationY = background.rotation;
      scene.environmentTexture = env;
      scene.environmentIntensity = env ? background.strength : 1;
      const color = Color3.FromArray(background ? background.color.map(v => v * (env ? 1 : background.strength)) : [0, 0, 0]);
      scene.clearColor = Color4.FromColor3(color.toGammaSpace().clampToRef(0, 1, new Color3()));
      worldLight.diffuse = world?.home === 'BLENDER' && !env ? color : Color3.Black();
      worldLight.groundColor = worldLight.diffuse.clone();
      setSkybox(background?.image, env && world.visibility.camera ? env : null, background, world?.home === 'BABYLON' && world.visibility.camera);
      if (preview) {
        Object.assign(preview, { env: scene.environmentTexture, intensity: scene.environmentIntensity });
        applyPreview();
      }
      scene.fogMode = volume ? fogModes[volume.type] : Scene.FOGMODE_NONE;
      if (volume) Object.assign(scene, { fogColor: Color3.FromArray(volume.color), fogDensity: volume.density, fogStart: volume.start, fogEnd: volume.end });
      gate();
    },
    // Rendered shading or camera view for the view about to render. Cheap; called per view.
    setRendered(value) { if (rendered !== value) { rendered = value; gate(); } },
    dispose() {
      skybox?.dispose(false, true);
      worldLight.dispose();
      previewSkybox?.dispose(false, true);
      for (const [key, tex] of textures) if (key !== 'scene') tex.dispose();
    },
  };
}
