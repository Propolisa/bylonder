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

function createGenerator(light, type, drawn) {
  const generator = new ShadowGenerator(MAP_SIZE, light);
  if (type === 'SUN') light.autoCalcShadowZBounds = true;
  // EEVEE filters its shadows by a pixel or two (shadow_filter_radius); a point light's cube map takes Poisson sampling.
  if (type === 'POINT') generator.usePoissonSampling = true;
  else Object.assign(generator, { usePercentageCloserFiltering: true, filteringQuality: ShadowGenerator.QUALITY_HIGH });
  Object.assign(generator, { bias: 0.002, normalBias: 0.02 });
  generator.getShadowMap().renderListPredicate = (mesh) => drawn() && casts(mesh);
  return generator;
}

export function createLightShadows(scene) {
  const generators = new Map(); // light -> { generator, type }
  let drawn = false;
  const sync = () => {
    for (const [light, entry] of generators) {
      const record = lightRecord(light);
      if (light.isDisposed() || !record?.use_shadow || record.type !== entry.type) { entry.generator.dispose(); generators.delete(light); }
    }
    for (const light of scene.lights) {
      const record = isBlenderLight(light) && lightRecord(light);
      if (record?.use_shadow && CASTS.includes(record.type) && !generators.has(light)) generators.set(light, { generator: createGenerator(light, record.type, () => drawn), type: record.type });
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
