// Shadows of Blender's lights as Babylon's shadow generators: a light whose Cast Shadow (use_shadow) is on has one, a
// sun's cascaded as EEVEE's sun shadow is (directional clipmaps), and every object whose Visibility > Shadow is on casts
// into it. Materials receive them through Babylon's own light code. Shadow maps are drawn for the views that show the
// scene's lights (Rendered shading, Render Image); other views draw them empty, which changes no material.
import { CascadedShadowGenerator, ShadowGenerator } from '@babylonjs/core';
import { isBlenderLight, lightRecord } from './light-home.js';
import { areaLightShadows } from './area-light.js';

const MAP_SIZE = 2048;
const CASTS = ['SUN', 'SPOT', 'POINT'];
// A mesh of the scene's objects (not an overlay or a helper), and whether it casts.
export const shadedObject = (mesh) => !mesh.name.startsWith('__') && !mesh.metadata?.overlay && mesh.getTotalVertices() > 0;
const casts = (mesh) => shadedObject(mesh) && mesh.metadata?.wbVisibleShadow !== false && mesh.isEnabled() && mesh.isVisible;

function createGenerator(light, type, drawn) {
  // A sun's map spans the view's frustum in cascades, fine near the eye, as EEVEE's clipmaps are: one map over the
  // whole scene's bounds is too coarse for what a large scene (a sky dome, a ground plane) holds.
  const generator = type === 'SUN' && CascadedShadowGenerator.IsSupported ? Object.assign(new CascadedShadowGenerator(MAP_SIZE, light), { numCascades: 4, lambda: 0.9, cascadeBlendPercentage: 0.05 })
    : new ShadowGenerator(MAP_SIZE, light);
  // EEVEE filters its shadows by a pixel or two (shadow_filter_radius); a cube map (a point or area light's) takes
  // Poisson sampling.
  if (light.needCube()) generator.usePoissonSampling = true;
  else Object.assign(generator, { usePercentageCloserFiltering: true, filteringQuality: ShadowGenerator.QUALITY_HIGH });
  Object.assign(generator, { bias: 0.002, normalBias: 0.02 });
  generator.getShadowMap().renderListPredicate = (mesh) => drawn() && casts(mesh);
  return generator;
}

export function createLightShadows(scene) {
  const generators = new Map(); // light -> { generator, type }
  let drawn = false, counted = '';
  // Every light lights every material, as in Blender (Babylon's materials take 4 unless told more), up to what a vertex
  // shader holds: a uniform block per light besides the scene's, mesh's and material's (and one spare).
  const gl = scene.getEngine()._gl, blocks = gl?.getParameter?.(gl.MAX_VERTEX_UNIFORM_BLOCKS) ?? 12;
  const lightAll = () => {
    const count = Math.min(scene.lights.length, blocks - 4), key = `${count}:${scene.materials.length}`;
    if (key === counted) return;
    counted = key;
    for (const material of scene.materials) if (material.maxSimultaneousLights < count) material.maxSimultaneousLights = count;
  };
  const casting = (record) => record?.use_shadow && (CASTS.includes(record.type) || (record.type === 'AREA' && areaLightShadows.enabled(scene)));
  const sync = () => {
    lightAll();
    for (const [light, entry] of generators) {
      const record = lightRecord(light);
      if (light.isDisposed() || !casting(record) || record.type !== entry.type) { entry.generator.dispose(); generators.delete(light); }
    }
    for (const light of scene.lights) {
      const record = isBlenderLight(light) && lightRecord(light);
      if (casting(record) && !generators.has(light)) generators.set(light, { generator: createGenerator(light, record.type, () => drawn), type: record.type });
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
