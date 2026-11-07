import { Color3, Color4, Constants, CubeMapToSphericalPolynomialTools, CubeTexture, EXRCubeTexture, HDRCubeTexture, RenderTargetTexture, Scene } from '@babylonjs/core';

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
      : { ...defaults.background, input: 'COLOR', color: blender?.color ?? linear(scene.clearColor), strength: blender?.strength ?? 1 },
    volume: { type: Object.entries(fogModes).find(([, mode]) => mode === scene.fogMode)?.[0] || 'NONE', color: rgb(scene.fogColor), density: scene.fogDensity, start: scene.fogStart, end: scene.fogEnd },
    visibility: { camera: texture ? skyboxes.some(m => m.isEnabled(false)) : true },
  };
}

export function createWorldRenderer(scene, { asset = path => path, studioLight } = {}) {
  const authoredTexture = scene.environmentTexture;
  const authoredSkyboxes = scene.meshes.filter(m => m.infiniteDistance && !m.name.startsWith('__'));
  const textures = new Map(authoredTexture ? [['scene', authoredTexture]] : []);
  let skybox = null, skyboxKey = '', rendered = false, sceneLinear = false, useAuthored = false, backgroundColor = new Color3();
  const probe = worldProbe(scene);
  const texture = key => {
    if (!key) return null;
    if (!textures.has(key)) {
      const url = /^(https?|file):/.test(key) ? key : asset(key);
      const tex = /\.hdr$/i.test(key) ? new HDRCubeTexture(url, scene, 256)
        : /\.exr$/i.test(key) ? new EXRCubeTexture(url, scene, 256, false, true, false, true)
          : CubeTexture.CreateFromPrefilteredData(url, scene);
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
    // A view not rendered draws its own background.
    if (rendered) showBackground();
  };
  const showBackground = () => {
    scene.clearColor = Color4.FromColor3(rendered && sceneLinear ? backgroundColor : backgroundColor.toGammaSpace().clampToRef(0, 1, new Color3()));
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
  // Material Preview as Blender's defaults show it: its studio light (forest.exr, at intensity 1) lighting the scene, with
  // neither the scene's lights nor its world, and no background (opacity 0: the view's own). Set when shading changes,
  // not per view: switching the environment or lights recompiles materials. The scene's lights are left out by a layer
  // no mesh is on, which leaves their settings as they are.
  const NO_MESH_LAYER = 0x10000000;
  let preview = null;
  const applyPreview = () => {
    scene.environmentTexture = texture(studioLight);
    scene.environmentIntensity = 1;
    for (const light of scene.lights) if (!preview.lights.has(light)) { preview.lights.set(light, light.includeOnlyWithLayerMask); light.includeOnlyWithLayerMask = NO_MESH_LAYER; }
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
    preview = null;
  };
  return {
    hasAuthoredTexture: !!authoredTexture,
    // Material Preview's lighting for the scene, while a view shows it.
    setPreview,
    // Rebuilds the world's Babylon state. Solid and Wireframe views show no world background or volume, as in Blender.
    render(world) {
      const background = world?.background, volume = world?.volume;
      const env = background?.input === 'ENVIRONMENT' ? texture(background.image) : null;
      if (env) env.rotationY = background.rotation;
      const color = Color3.FromArray(background ? background.color.map(v => v * (env ? 1 : background.strength)) : [0, 0, 0]);
      const lights = world?.home === 'BLENDER' && !env;
      if (lights) probe.set(color);
      scene.environmentTexture = env ?? (lights ? probe.texture : null);
      scene.environmentIntensity = env ? background.strength : 1;
      backgroundColor = color;
      showBackground();
      setSkybox(background?.image, env && world.visibility.camera ? env : null, background, world?.home === 'BABYLON' && world.visibility.camera);
      if (preview) {
        Object.assign(preview, { env: scene.environmentTexture, intensity: scene.environmentIntensity });
        applyPreview();
      }
      scene.fogMode = volume ? fogModes[volume.type] : Scene.FOGMODE_NONE;
      if (volume) Object.assign(scene, { fogColor: Color3.FromArray(volume.color), fogDensity: volume.density, fogStart: volume.start, fogEnd: volume.end });
      gate();
    },
    // Rendered shading for the view about to render. Cheap; called per view.
    setRendered(value, linear = false) { if (rendered !== value || sceneLinear !== linear) { rendered = value; sceneLinear = linear; gate(); } },
    dispose() {
      skybox?.dispose(false, true);
      if (scene.environmentTexture === probe.texture) scene.environmentTexture = null;
      probe.dispose();
      for (const [key, tex] of textures) if (key !== 'scene') tex.dispose();
    },
  };
}

// A world color as EEVEE's world probe (eevee_lightprobe_sphere.cc): the world drawn into a cubemap, which surfaces
// reflect at every roughness and whose spherical harmonics light them diffusely.
function worldProbe(scene) {
  const texture = new RenderTargetTexture('__worldProbe', 1, scene, { isCube: true, type: Constants.TEXTURETYPE_FLOAT, generateMipMaps: false, doNotChangeAspectRatio: true });
  Object.assign(texture, { gammaSpace: false, renderList: [], refreshRate: RenderTargetTexture.REFRESHRATE_RENDER_ONCE });
  scene.customRenderTargets.push(texture);
  return {
    texture,
    set(color) {
      texture.clearColor = Color4.FromColor3(color);
      texture.resetRefreshCounter();
      const face = Float32Array.of(color.r, color.g, color.b, 1);
      texture.sphericalPolynomial = CubeMapToSphericalPolynomialTools.ConvertCubeMapToSphericalPolynomial({
        size: 1, right: face, left: face, up: face, down: face, front: face, back: face, format: Constants.TEXTUREFORMAT_RGBA, type: Constants.TEXTURETYPE_FLOAT, gammaSpace: false });
    },
    dispose() {
      scene.customRenderTargets.splice(scene.customRenderTargets.indexOf(texture), 1);
      texture.dispose();
    },
  };
}
