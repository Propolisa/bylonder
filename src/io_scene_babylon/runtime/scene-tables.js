// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// A package's scene as tables of data keyed by datablock (`OB:Cube`, `MA:Lava`): a patch is `{ table: { key: entry or
// null } }`, and a full load is a patch applied to an empty scene. Each table's entries become Babylon objects in order,
// materials before the meshes using them and nodes before what hangs from them; the package's `parsers` make what
// Babylon's own Parse functions read (each imported by scene.js only where its scene uses it), and nodes are made here.
import { Color3, Geometry, Matrix, Mesh, Quaternion, SubMesh, TransformNode, Animation } from '@babylonjs/core';

/**
 * @typedef {Record<string, Record<string, any>>} Tables a table's entries by key, each table by name
 * @typedef {Record<string, (entry: any, key: string, made: Record<string, any>) => any>} Parsers what makes a table's entry, by table
 *   name, given what is made so far
 * @typedef {{ scene: import('@babylonjs/core').Scene, lookup: import('@babylonjs/core').Scene, buffers: import('./buffers.js').Buffers, parsers: Parsers }} Loading
 */

/** The tables in the order their entries are made. */
export const TABLES = ['materials', 'multiMaterials', 'skeletons', 'morphTargets', 'geometries', 'nodes', 'lights', 'cameras', 'reflectionProbes', 'shadowGenerators', 'particleSystems', 'animationGroups'];
// The node properties a node's entry sets, and the name each has in Babylon.
const PROPERTIES = { isVisible: 'isVisible', visibility: 'visibility', receiveShadows: 'receiveShadows', pickable: 'isPickable', billboardMode: 'billboardMode', checkCollisions: 'checkCollisions',
  infiniteDistance: 'infiniteDistance', layerMask: 'layerMask', alwaysSelectAsActiveMesh: 'alwaysSelectAsActiveMesh', isBlocker: 'isBlocker', hasVertexAlpha: 'hasVertexAlpha' };

/**
 * A geometry from its vertex buffers by kind (`[size, buffer]`) and its indices, buffers of scene.bin.
 * @param {import('@babylonjs/core').Scene} scene @param {{ vertices: Record<string, [number, string]>, indices?: string }} entry @param {string} key @param {import('./buffers.js').Buffers} buffers
 */
function geometry(scene, { vertices, indices }, key, buffers) {
  const made = new Geometry(key, scene);
  for (const [kind, [size, buffer]] of Object.entries(vertices)) made.setVerticesData(kind, /** @type {any} */ (buffers[buffer]), false, size);
  if (indices !== undefined) made.setIndices(/** @type {any} */ (buffers[indices]));
  return made;
}

/**
 * A mesh or transform node from its entry (js-export.js nodeEntry).
 * @param {Loading} loading @param {Record<string, any>} entry @param {Record<string, any>} made what the tables made, by table and key
 */
function node({ scene, lookup, buffers, parsers }, entry, made) {
  /** @type {any} */
  let node;
  if (entry.type === 'TransformNode') node = new TransformNode(entry.name, scene);
  else {
    node = entry.type === 'LinesMesh' ? parsers.linesMesh(entry, entry.name, {}) : new Mesh(entry.name, scene);
    if (entry.color) node.color = Color3.FromArray(entry.color);
    if (entry.alpha !== undefined) node.alpha = entry.alpha;
    if (entry.unIndexed) node.isUnIndexed = true;
    if (entry.geometry !== undefined) made.geometries[entry.geometry].applyToMesh(node);
  }
  node.id = entry.id;
  node.position.fromArray(entry.position);
  if (entry.rotationQuaternion) node.rotationQuaternion = Quaternion.FromArray(entry.rotationQuaternion);
  else if (entry.rotation) node.rotation.fromArray(entry.rotation);
  if (entry.scaling) node.scaling.fromArray(entry.scaling);
  if (entry.pivotMatrix) node.setPivotMatrix(Matrix.FromArray(entry.pivotMatrix), false);
  if (entry.enabled === false) node.setEnabled(false);
  for (const [key, value] of Object.entries(entry.set ?? {})) node[PROPERTIES[/** @type {keyof PROPERTIES} */ (key)]] = value;
  if (entry.alphaIndex !== undefined) node.alphaIndex = entry.alphaIndex;
  if (entry.material !== undefined) node.material = made.materialsByKey[entry.material] ?? null;
  if (entry.subMeshes) {
    node.subMeshes = [];
    for (const [material, verticesStart, verticesCount, indexStart, indexCount] of entry.subMeshes) new SubMesh(material, verticesStart, verticesCount, indexStart, indexCount, node);
  }
  if (entry.skeleton !== undefined) Object.assign(node, { skeleton: lookup.getSkeletonById(entry.skeleton), numBoneInfluencers: entry.numBoneInfluencers });
  if (entry.morphTargets !== undefined) node.morphTargetManager = made.morphTargets[entry.morphTargets];
  if (entry.thinInstances !== undefined) node.thinInstanceSetBuffer('matrix', buffers[entry.thinInstances], 16, true);
  for (const instance of entry.instances ?? []) {
    const copy = node.createInstance(instance.name);
    copy.position.fromArray(instance.position);
    if (instance.rotationQuaternion) copy.rotationQuaternion = Quaternion.FromArray(instance.rotationQuaternion);
    else copy.rotation.fromArray(instance.rotation);
    copy.scaling.fromArray(instance.scaling);
  }
  if (entry.animations) node.animations = entry.animations.map((/** @type {any} */ a) => Animation.Parse(a));
  if (entry.metadata) node.metadata = entry.metadata;
  return node;
}

/**
 * What hangs nodes together once they are made: parents, bones, pose matrices and the meshes lights leave out or light
 * alone, by the exported unique ids and ids.
 * @param {Loading} loading @param {Tables} tables @param {Record<string, any>} made
 */
function link({ lookup }, tables, made) {
  const byUniqueId = made.nodesById;
  for (const table of ['nodes', 'lights', 'cameras']) for (const entry of Object.values(tables[table] ?? {})) {
    if (entry.parentId !== undefined) byUniqueId[entry.uniqueId].parent = byUniqueId[entry.parentId] ?? null;
  }
  for (const entry of Object.values(tables.nodes ?? {})) {
    const { parentBone, poseMatrix } = entry;
    if (parentBone) byUniqueId[entry.uniqueId].attachToBone(lookup.getSkeletonById(parentBone.skeletonId)?.bones[parentBone.index], byUniqueId[parentBone.meshId]);
    if (poseMatrix) byUniqueId[entry.uniqueId].updatePoseMatrix(Matrix.FromArray(poseMatrix));
  }
  const meshes = (/** @type {string[]} */ ids) => ids.map((id) => lookup.getMeshById(id)).filter(Boolean);
  for (const entry of Object.values(tables.lights ?? {})) {
    const light = byUniqueId[entry.uniqueId];
    if (entry.excludedMeshesIds?.length) light.excludedMeshes = meshes(entry.excludedMeshesIds);
    if (entry.includedOnlyMeshesIds?.length) light.includedOnlyMeshes = meshes(entry.includedOnlyMeshesIds);
  }
}

/**
 * An animation group's entry: its settings with the tracks each datablock gives it (`animations`: by datablock, then by
 * group key), its packed bone tracks one table, or a list of them.
 * @param {string} key @param {Record<string, any>} settings @param {Tables | undefined} animations
 */
export function groupEntry(key, settings, animations) {
  const parts = Object.values(animations ?? {}).map((byGroup) => byGroup[key]).filter(Boolean);
  const tables = parts.flatMap((part) => part.bylonderTracks ?? []);
  return { ...settings, targetedAnimations: parts.flatMap((part) => part.targetedAnimations), ...(tables.length && { bylonderTracks: tables.length === 1 ? tables[0] : tables }) };
}

/**
 * Applies `patch` to an empty scene: each table's entries made in order, then linked. `parsers.lightsMade(lights)` runs
 * once the lights and shadows are made; a parser finds what it links to in `made`. Gives what it made, by table and key,
 * the materials and multi-materials by key, and the nodes by their exported unique ids.
 * @param {Loading} loading @param {Tables} patch
 */
export function loadTables(loading, patch) {
  const { scene, buffers, parsers } = loading;
  /** @type {Record<string, any>} */
  const made = Object.fromEntries(TABLES.map((table) => [table, {}]));
  // Materials and multi-materials by key, and nodes by their exported unique ids.
  Object.assign(made, { materialsByKey: {}, nodesById: {} });
  for (const table of TABLES) {
    for (let [key, entry] of Object.entries(patch[table] ?? {})) {
      if (!entry) continue;
      if (table === 'animationGroups') entry = groupEntry(key, entry, patch.animations);
      const object = table === 'nodes' ? node(loading, entry, made) : table === 'geometries' ? geometry(scene, entry, key, buffers) : parsers[table](entry, key, made);
      made[table][key] = object;
      if (table === 'materials' || table === 'multiMaterials') made.materialsByKey[key] = object;
      else if (entry.uniqueId !== undefined) made.nodesById[entry.uniqueId] = object;
    }
    if (table === 'cameras') link(loading, patch, made);
    if (table === 'shadowGenerators') parsers.lightsMade?.(Object.values(made.lights), '', made);
  }
  return made;
}
