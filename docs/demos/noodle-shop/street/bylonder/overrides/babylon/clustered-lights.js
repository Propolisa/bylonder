// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// Override of Babylon's lights per material: where a scene has more lights than a material's uniform blocks hold, its point and spot lights without shadows are drawn by one ClusteredLightContainer, as EEVEE culls lights in clusters with no cap per material; their falloff is the material's own (Babylon's clusters take no other), not glTF's window at their range, where EEVEE's light has faded to its threshold anyway; goes when Babylon's clustered lights take each light's falloff.
// The scene component, imported for the clustering step it registers.
import { ClusteredLightContainer } from '@babylonjs/core/Lights/Clustered/clusteredLightContainer.js';
import { ClusteredLightingSceneComponent } from '@babylonjs/core/Lights/Clustered/clusteredLightingSceneComponent.js';
import { Light } from '@babylonjs/core/Lights/light.js';

/** @typedef {import('@babylonjs/core').Scene} Scene */

/**
 * Whether a light can join a cluster once its falloff is the default (a point or spot light without shadows).
 * @param {Light} light
 */
function clusterable(light) {
  const falloff = light.falloffType;
  light.falloffType = Light.FALLOFF_DEFAULT;
  const can = ClusteredLightContainer.IsLightSupported(light);
  light.falloffType = falloff;
  return can;
}

/**
 * Every light of the scene's, the clustered ones too, which Babylon keeps in their container instead of scene.lights.
 * @param {Scene} scene
 */
export const sceneLights = (scene) => scene.lights.flatMap((light) => (light instanceof ClusteredLightContainer ? [...light.lights] : [light]));

/**
 * A node by id as Scene.getNodeById finds it, or a clustered light.
 * @param {Scene} scene @param {string} id
 */
export const nodeById = (scene, id) => scene.getNodeById(id) ?? sceneLights(scene).find((light) => light.id === id) ?? null;

/**
 * Where `lights` are more than a material takes (`budget`), their point and spot lights without shadows moved into one
 * clustered container on `scene`, which takes one place in a material. A light `exact(light)` (a custom distance,
 * which a cluster cuts only per screen tile) stays out while the budget leaves it a place. Gives the container and
 * the exact lights that joined it, or null where nothing joins (the engine has no clusters, or too few lights).
 * @param {Scene} scene @param {readonly Light[]} lights @param {number} budget @param {(light: Light) => boolean} [exact]
 */
export function clusterLights(scene, lights, budget, exact = () => false) {
  if (lights.length <= budget) return null;
  const able = lights.filter(clusterable), places = budget - (lights.length - able.length) - 1;
  const kept = new Set(able.filter(exact).slice(0, Math.max(0, places)));
  const joining = able.filter((light) => !kept.has(light));
  if (joining.length < 2) return null;
  const container = new ClusteredLightContainer('Bylonder Clustered Lights', [], scene);
  if (!container.isSupported) {
    container.dispose();
    return null;
  }
  container.maxRange = Math.max(...joining.map((light) => light.range));
  for (const light of joining) {
    light.falloffType = Light.FALLOFF_DEFAULT;
    container.addLight(light);
  }
  return { container, cutPerTile: joining.filter(exact) };
}
