// Shadows of Blender's lights as Babylon's shadow generators: a light whose Cast Shadow (use_shadow) is on has one, a
// sun's cascaded as EEVEE's sun shadow is (directional clipmaps), and every object whose Visibility > Shadow is on casts
// into it. Materials receive them through Babylon's own light code. Shadow maps are drawn for the views that show the
// scene's lights (Rendered shading, Render Image); other views draw them empty, which changes no material.
import { CascadedShadowGenerator, ShadowGenerator } from '@babylonjs/core';
import { isBlenderLight, lightRecord } from './light-home.js';

const MAP_SIZE = 2048;
// Babylon has no shadows of rectangular area lights.
const CASTS = ['SUN', 'SPOT', 'POINT'];
// A mesh of the scene's objects (not an overlay or a helper), and whether it casts.
export const shadedObject = (mesh) => !mesh.name.startsWith('__') && !mesh.metadata?.overlay && mesh.getTotalVertices() > 0;
const casts = (mesh) => shadedObject(mesh) && mesh.metadata?.wbVisibleShadow !== false && mesh.isEnabled() && mesh.isVisible;

// A sun's cascades fit the view (EEVEE's directional clipmaps follow it): a texel about a pixel of the view, the
// nearest power of two at or above its size. An engine without texture arrays gives a sun one map.
const cascaded = (type) => type === 'SUN' && CascadedShadowGenerator.IsSupported;
const mapSize = (type, engine) => (cascaded(type) ? Math.min(4096, 2 ** Math.ceil(Math.log2(Math.max(256, engine.getRenderWidth(), engine.getRenderHeight())))) : MAP_SIZE);
function createGenerator(light, type, size, drawn) {
  const generator = cascaded(type) ? Object.assign(new CascadedShadowGenerator(size, light), { numCascades: 4, lambda: 0.9, stabilizeCascades: false })
    : new ShadowGenerator(size, light);
  if (type === 'SUN' && !cascaded(type)) light.autoCalcShadowZBounds = true;
  // EEVEE filters its shadows by about a texel (shadow_filter_radius 1); a point light's cube map takes Poisson sampling.
  if (type === 'POINT') generator.usePoissonSampling = true;
  else Object.assign(generator, { usePercentageCloserFiltering: true, filteringQuality: cascaded(type) ? ShadowGenerator.QUALITY_LOW : ShadowGenerator.QUALITY_HIGH });
  Object.assign(generator, { bias: 0.002, normalBias: 0.02 });
  generator.getShadowMap().renderListPredicate = (mesh) => drawn() && casts(mesh);
  return generator;
}

export function createLightShadows(scene) {
  const generators = new Map(); // light -> { generator, type, size }
  let drawn = false;
  const sync = () => {
    const engine = scene.getEngine();
    for (const [light, entry] of generators) {
      const record = lightRecord(light);
      if (light.isDisposed() || !record?.use_shadow || record.type !== entry.type || entry.size !== mapSize(entry.type, engine)) { entry.generator.dispose(); generators.delete(light); }
    }
    for (const light of scene.lights) {
      const record = isBlenderLight(light) && lightRecord(light), size = record && mapSize(record.type, engine);
      if (record?.use_shadow && CASTS.includes(record.type) && !generators.has(light)) generators.set(light, { generator: createGenerator(light, record.type, size, () => drawn), type: record.type, size });
    }
    for (const mesh of scene.meshes) if (shadedObject(mesh)) mesh.receiveShadows = true;
  };
  return {
    // Per view, before it renders: whether it shows the scene's lights.
    setActive(value) { drawn = value; sync(); },
    get generators() { return [...generators.values()].map((entry) => entry.generator); },
    dispose() { for (const { generator } of generators.values()) generator.dispose(); generators.clear(); },
  };
}
