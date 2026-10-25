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

export function createWorldRenderer(scene, { asset = path => path } = {}) {
  const authoredTexture = scene.environmentTexture;
  const authoredSkyboxes = scene.meshes.filter(m => m.infiniteDistance && !m.name.startsWith('__'));
  const textures = new Map(authoredTexture ? [['scene', authoredTexture]] : []);
  let skybox = null, skyboxKey = '';
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
  const setSkybox = (key, tex, background) => {
    const useAuthored = !!tex && key === 'scene' && authoredSkyboxes.length > 0;
    authoredSkyboxes.forEach(mesh => mesh.setEnabled(useAuthored));
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
  return {
    hasAuthoredTexture: !!authoredTexture,
    // rendered: Rendered shading or camera view. Solid and Wireframe show no world background or volume, as in Blender.
    render(world, { rendered }) {
      const background = world?.background, volume = world?.volume;
      const env = background?.input === 'ENVIRONMENT' ? texture(background.image) : null;
      if (env) env.rotationY = background.rotation;
      scene.environmentTexture = env;
      scene.environmentIntensity = env ? background.strength : 1;
      const color = background ? background.color.map(v => v * (env ? 1 : background.strength)) : [0, 0, 0];
      scene.clearColor = new Color4(...color.map(v => Math.min(1, v)), 1);
      setSkybox(background?.image, rendered && env && world.visibility.camera ? env : null, background);
      scene.fogMode = volume ? fogModes[volume.type] : Scene.FOGMODE_NONE;
      scene.fogEnabled = rendered;
      if (volume) Object.assign(scene, { fogColor: Color3.FromArray(volume.color), fogDensity: volume.density, fogStart: volume.start, fogEnd: volume.end });
    },
    dispose() {
      skybox?.dispose(false, true);
      for (const [key, tex] of textures) if (key !== 'scene') tex.dispose();
    },
  };
}
