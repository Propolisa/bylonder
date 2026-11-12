// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// Override of Babylon's lights per material: where a scene has more lights than a material's uniform blocks hold, its point and spot lights without shadows are drawn by one ClusteredLightContainer, as EEVEE culls lights in clusters with no cap per material; their falloff is the material's (Babylon's clusters take no other), which the materials set to glTF's window at each light's range, as Bylonder's lights fall off; goes when Babylon's clustered lights take each light's falloff.
// The scene component, imported for the clustering step it registers.
import { ClusteredLightContainer, ClusteredLightingSceneComponent, Constants, Light } from '@babylonjs/core';

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
 * A material falling off the lights that take no falloff of their own (the clustered ones, which Babylon falls off by
 * the material's) by glTF's window at each light's range, as Bylonder's lights fall off (light-home.js), not by the
 * physical inverse square, which lights far past a light's reach.
 * @param {import('@babylonjs/core').Material} material
 */
function windowed(material) {
  const pbr = /** @type {any} */ (material), blocks = /** @type {any} */ (material).attachedBlocks ?? [];
  if ('useGLTFLightFalloff' in pbr && !pbr.useGLTFLightFalloff) pbr.useGLTFLightFalloff = true;
  for (const block of blocks) {
    if (!('lightFalloff' in block) || block.lightFalloff === 1) continue;
    block.lightFalloff = 1;
    material.markAsDirty(Constants.MATERIAL_AllDirtyFlag);
  }
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
  // Every material, those a page adds later too, windows the clustered lights.
  let materials = -1;
  scene.onBeforeRenderObservable.add(() => {
    if (scene.materials.length === materials) return;
    materials = scene.materials.length;
    scene.materials.forEach(windowed);
  });
  return { container, cutPerTile: joining.filter(exact) };
}
