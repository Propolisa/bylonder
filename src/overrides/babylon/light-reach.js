// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// Override of Babylon's lights per material (maxSimultaneousLights, 4 by default, and a mesh's lights in the scene's order): every material takes as many lights as a shader's uniform blocks hold, and each mesh the lights that reach it, the strongest at it first, as EEVEE has no cap and culls each light beyond its influence radius (its range); goes when Babylon binds lights per mesh by reach.
import { Constants } from '@babylonjs/core';

/** @typedef {import('@babylonjs/core').Scene} Scene @typedef {import('@babylonjs/core').Light} Light @typedef {import('@babylonjs/core').AbstractMesh} AbstractMesh */
/** @typedef {{ id: number | string, position: number[] | null, reach?: number, power?: number }} ReachingLight */
/** @typedef {{ id: number | string, center: number[], radius: number }} MeshSphere */

/**
 * The lights a material can take: a uniform block each, besides the scene's, mesh's and material's (and one spare).
 * @param {import('@babylonjs/core').AbstractEngine} engine
 */
export function lightBudget(engine) {
  const known = BUDGETS.get(engine);
  if (known) return known;
  const gl = /** @type {any} */ (engine)._gl, limits = /** @type {any} */ (engine).currentLimits;
  const blocks = limits?.maxUniformBuffersPerShaderStage
    ?? (gl?.getParameter ? Math.min(gl.getParameter(gl.MAX_VERTEX_UNIFORM_BLOCKS), gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_BLOCKS)) : null) ?? 12;
  const budget = Math.max(1, blocks - 4);
  BUDGETS.set(engine, budget);
  return budget;
}
const BUDGETS = new WeakMap();

/**
 * A light's strength at a mesh's bounding sphere: its power over the squared distance to the sphere (at least half a
 * meter, so a light at or inside a mesh counts fully whatever its size); 0 past its reach; everywhere without a position.
 * @param {ReachingLight} light @param {MeshSphere} mesh
 */
function strengthAt(light, mesh) {
  if (!light.position) return Infinity;
  const distance = Math.max(0, Math.hypot(...light.position.map((v, i) => v - mesh.center[i])) - mesh.radius);
  if (distance > /** @type {number} */ (light.reach)) return 0;
  return /** @type {number} */ (light.power) / Math.max(distance, 0.5) ** 2;
}

/**
 * For each mesh, the ids of the lights that light it, at most `budget`, the strongest at it first; and the meshes
 * reached by more lights than that, each with how many it leaves out. `reaches(light, mesh)` keeps a light off a mesh it is never to light.
 * @param {ReachingLight[]} lights @param {MeshSphere[]} meshes @param {number} budget
 * @param {(light: ReachingLight, mesh: MeshSphere) => boolean} [reaches]
 */
export function chooseLights(lights, meshes, budget, reaches = () => true) {
  const chosen = new Map(), crowded = [];
  for (const mesh of meshes) {
    const reaching = lights.filter((light) => reaches(light, mesh)).map((light) => [light.id, strengthAt(light, mesh)])
      .filter(([, strength]) => /** @type {number} */ (strength) > 0).sort((a, b) => /** @type {number} */ (b[1]) - /** @type {number} */ (a[1]));
    if (reaching.length > budget) crowded.push([mesh.id, reaching.length - budget]);
    chosen.set(mesh.id, new Set(reaching.slice(0, budget).map(([id]) => id)));
  }
  return { chosen, crowded };
}

/**
 * A light that lights some mesh: not one kept off every mesh by its layer mask, which takes no place in a material.
 * @param {Light} light
 */
export const lightsMeshes = (light) => !light.includeOnlyWithLayerMask || (light.includeOnlyWithLayerMask & 0x0fffffff) !== 0;

/**
 * A light of the scene's as chooseLights takes it: one with a range reaches as far, its power as its range squared (a
 * light's influence radius grows with the square root of its power); a light without one, a sun's or the page's own,
 * reaches everywhere and comes first.
 * @param {Light} light @param {boolean} owned
 * @returns {ReachingLight}
 */
function reachingLight(light, owned) {
  const ranged = owned && 'position' in light && light.range < Number.MAX_VALUE;
  if (!ranged) return { id: light.uniqueId, position: null };
  const position = /** @type {any} */ (light).getAbsolutePosition();
  return { id: light.uniqueId, position: [position.x, position.y, position.z], reach: light.range, power: light.range ** 2 };
}

/**
 * A light's excluded meshes set: Babylon's setter takes the light off the meshes now excluded but does not give it back
 * to those no longer excluded.
 * @param {Light} light @param {AbstractMesh[]} meshes
 */
function exclude(light, meshes) {
  const before = light.excludedMeshes;
  light.excludedMeshes = meshes;
  for (const mesh of before) if (!meshes.includes(mesh)) /** @type {any} */ (mesh)._resyncLightSource(light);
}

/**
 * The scene's lights in an order by kind (type and shadow), so that meshes taking different lights of the same kinds
 * share a material's shader; true when that changed it.
 * @param {Scene} scene
 */
function orderLights(scene) {
  const kind = (/** @type {Light} */ light) => `${light.getShadowGenerator() ? 0 : 1}${light.getClassName()}`;
  const ordered = [...scene.lights].sort((a, b) => (kind(a) < kind(b) ? -1 : kind(a) > kind(b) ? 1 : 0));
  if (ordered.every((light, i) => scene.lights[i] === light)) return false;
  scene.lights.splice(0, scene.lights.length, ...ordered);
  return true;
}

/** @param {AbstractMesh} mesh @returns {MeshSphere} */
const meshSphere = (mesh) => {
  const sphere = mesh.getBoundingInfo().boundingSphere;
  return { id: mesh.uniqueId, center: [sphere.centerWorld.x, sphere.centerWorld.y, sphere.centerWorld.z], radius: sphere.radiusWorld };
};

/**
 * Keeps every material taking as many of the scene's lights as it can, and each light `owns(light)` gives off the
 * meshes that do not choose it (its excluded meshes): all meshes again when the scene's lights change or one of its
 * own moves, else only the meshes that moved or came. Other lights (the page's own) keep their own included and
 * excluded meshes and come first where they light. `warn(message)` hears once of each mesh that more lights reach
 * than its material takes.
 * @param {Scene} scene
 * @param {{ owns?: (light: Light) => boolean, warn?: (message: string) => void }} [options]
 */
export function createLightReach(scene, { owns = () => true, warn = () => {} } = {}) {
  let counted = '', lightState = /** @type {number[]} */ ([]);
  const placed = new Map(); // mesh -> its world matrix's update flag (which only grows) when its lights were chosen
  const warned = new Set(), dropped = new Map();
  const fitMaterials = (/** @type {number} */ count) => {
    const key = `${count}:${scene.materials.length}`;
    if (key === counted) return;
    counted = key;
    for (const material of scene.materials) {
      if (!('maxSimultaneousLights' in material) || /** @type {any} */ (material).maxSimultaneousLights >= count) continue;
      /** @type {any} */ (material).maxSimultaneousLights = count;
      material.markAsDirty(Constants.MATERIAL_LightDirtyFlag);
    }
  };
  // What every mesh's choice reads of the lights, as numbers: which there are, where the scene's own are and how far
  // they reach, and which meshes the page's own are given.
  const lightsChanged = (/** @type {number} */ budget, /** @type {Light[]} */ lights) => {
    const next = [budget];
    for (const l of lights) {
      next.push(l.uniqueId, l.includedOnlyMeshes.length);
      if (owns(l)) next.push(/** @type {any} */ (l).getWorldMatrix?.().updateFlag ?? 0, l.range);
      else next.push(l.excludedMeshes.length);
    }
    const same = next.length === lightState.length && next.every((v, i) => v === lightState[i]);
    lightState = next;
    return !same;
  };
  const report = (/** @type {AbstractMesh} */ mesh, /** @type {number} */ count, /** @type {number} */ budget) => {
    if (count) dropped.set(mesh, count);
    else dropped.delete(mesh);
    if (!count || warned.has(mesh.name)) return;
    warned.add(mesh.name);
    warn(`"${mesh.name}" is reached by more lights than its material can take (${budget}); the weakest at it are left out`);
  };
  // The lights of `meshes` chosen again; `all` when they are every mesh, whose lights' excluded meshes are set at once.
  const choose = (/** @type {Light[]} */ lights, /** @type {AbstractMesh[]} */ meshes, /** @type {number} */ budget, all = false) => {
    for (const mesh of meshes) placed.set(mesh, mesh.getWorldMatrix().updateFlag);
    const owned = lights.filter(owns);
    if (lights.length <= budget) {
      dropped.clear();
      for (const light of owned) if (light.excludedMeshes.length) exclude(light, []);
      return;
    }
    const byId = new Map(lights.map((light) => [light.uniqueId, light])), meshById = new Map(meshes.map((mesh) => [mesh.uniqueId, mesh]));
    // A light of the page's lights only the meshes it is given (its own included and excluded meshes, its layer mask).
    const reaches = (/** @type {ReachingLight} */ l, /** @type {MeshSphere} */ m) => {
      const light = /** @type {Light} */ (byId.get(/** @type {number} */ (l.id))), mesh = /** @type {AbstractMesh} */ (meshById.get(/** @type {number} */ (m.id)));
      return owns(light) || light.canAffectMesh(mesh);
    };
    const { chosen, crowded } = chooseLights(lights.map((light) => reachingLight(light, owns(light))), meshes.map(meshSphere), budget, reaches);
    const left = new Map(crowded);
    for (const mesh of meshes) report(mesh, left.get(mesh.uniqueId) ?? 0, budget);
    for (const light of owned) {
      if (all) {
        const excluded = meshes.filter((mesh) => !chosen.get(mesh.uniqueId).has(light.uniqueId));
        const same = excluded.length === light.excludedMeshes.length && excluded.every((mesh, i) => light.excludedMeshes[i] === mesh);
        if (!same) exclude(light, excluded);
        continue;
      }
      // Babylon's excluded meshes array takes a light off a mesh pushed to it and gives it back to one spliced out.
      for (const mesh of meshes) {
        const at = light.excludedMeshes.indexOf(mesh), lit = chosen.get(mesh.uniqueId).has(light.uniqueId);
        if (lit && at >= 0) light.excludedMeshes.splice(at, 1);
        else if (!lit && at < 0) light.excludedMeshes.push(mesh);
      }
    }
  };
  return {
    /** @param {number} [budget] the lights a material takes, by default as many as its shader holds */
    update(budget = lightBudget(scene.getEngine())) {
      const lights = scene.lights.filter((light) => light.isEnabled() && lightsMeshes(light));
      fitMaterials(Math.min(lights.length, budget));
      const meshes = scene.meshes.filter((mesh) => mesh.material && mesh.getTotalVertices() > 0);
      if (lightsChanged(budget, lights) || meshes.length !== placed.size || meshes.some((mesh) => !placed.has(mesh))) {
        placed.clear();
        if (orderLights(scene)) for (const mesh of scene.meshes) /** @type {any} */ (mesh)._resyncLightSources();
        choose(lights, meshes, budget, true);
        return;
      }
      const moved = meshes.filter((mesh) => placed.get(mesh) !== mesh.getWorldMatrix().updateFlag);
      if (moved.length) choose(lights, moved, budget);
    },
    /** Each mesh more lights reach than its material takes, with how many of them it leaves out. */
    dropped,
  };
}

// A scene's reach, kept on the scene by a registered symbol: one for all the packages a page loads, each with its copy
// of this module, so that none takes another's lights for the page's own.
const PAGE = Symbol.for('bylonder.light-reach');

/**
 * An exported page's lights lit by reach: `lights`, the package's, are kept off the meshes that do not choose them;
 * lights the page adds itself come first wherever they light. Updated before each frame's meshes are chosen.
 * @param {Scene} scene @param {Light[]} lights
 */
export function reachLights(scene, lights) {
  let page = /** @type {any} */ (scene)[PAGE];
  if (!page) {
    const owned = new WeakSet();
    let warned = false;
    const warn = (/** @type {string} */ message) => { if (!warned) console.warn(`${message} (and maybe others)`); warned = true; };
    page = { owned, reach: createLightReach(scene, { owns: (light) => owned.has(light), warn }) };
    /** @type {any} */ (scene)[PAGE] = page;
    scene.onBeforeActiveMeshesEvaluationObservable.add(() => page.reach.update());
  }
  for (const light of lights) page.owned.add(light);
  page.reach.update();
}
