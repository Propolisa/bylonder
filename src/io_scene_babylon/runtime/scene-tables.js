// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// A package's scene as tables of data keyed by datablock (`OB:Cube`, `MA:Lava`), and the Babylon objects made from them
// (docs/data-flow.md). A patch is `{ base, version, tables: { table: { key: entry or null } }, buffers }`; a full load is
// a patch applied to an empty scene, the same path. Entries become objects in table order, materials before the meshes
// using them and nodes before what hangs from them; the package's `parsers` make what Babylon's own Parse functions read
// (each imported by scene.js only where its scene uses it), and nodes are made here. A patch is all or nothing: its
// objects are made before any is swapped in, and one that fails leaves the scene as it was.
import { Color3, Geometry, Matrix, Mesh, Quaternion, SubMesh, TransformNode, Animation } from '@babylonjs/core';

/**
 * @typedef {Record<string, Record<string, any>>} Tables a table's entries by key, each table by name
 * @typedef {Record<string, (entry: any, key: string, made: Record<string, any>) => any>} Parsers what makes a table's entry, by table
 *   name, given what is made so far
 * @typedef {{ scene: import('@babylonjs/core').Scene, lookup: import('@babylonjs/core').Scene, buffers: import('./buffers.js').Buffers, parsers: Parsers }} Loading
 * @typedef {{ base?: string | null, version?: string | null, tables: Tables, buffers?: import('./buffers.js').Buffers }} Patch
 */

// The tables of what has a place in the scene, which a node's parent names by key.
const PLACED = ['nodes', 'lights', 'cameras'];
/** The tables in the order their entries are made. */
export const TABLES = ['materials', 'multiMaterials', 'skeletons', 'morphTargets', 'geometries', 'nodes', 'lights', 'cameras', 'reflectionProbes', 'shadowGenerators', 'particleSystems', 'animationGroups'];
// The node properties a node's entry sets, with Babylon's name and default for each.
/** @type {Record<string, [string, any]>} */
const PROPERTIES = { isVisible: ['isVisible', true], visibility: ['visibility', 1], receiveShadows: ['receiveShadows', false], pickable: ['isPickable', true], billboardMode: ['billboardMode', 0],
  checkCollisions: ['checkCollisions', false], infiniteDistance: ['infiniteDistance', false], layerMask: ['layerMask', 0x0fffffff], alwaysSelectAsActiveMesh: ['alwaysSelectAsActiveMesh', false],
  isBlocker: ['isBlocker', false], hasVertexAlpha: ['hasVertexAlpha', false] };
// What a node is made with, which a patch changes only by making it again; the rest it sets on the node it has.
const MADE_WITH = ['type', 'geometry', 'subMeshes', 'skeleton', 'morphTargets', 'thinInstances', 'instances', 'animations', 'metadata', 'parentBone', 'poseMatrix', 'color', 'alpha', 'unIndexed'];
const same = (/** @type {any} */ a, /** @type {any} */ b) => JSON.stringify(a) === JSON.stringify(b);

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
 * What a patch may change on a node it keeps: its transform, flags and material.
 * @param {any} node @param {Record<string, any>} entry @param {Record<string, any>} made
 */
function place(node, entry, made) {
  node.id = entry.id;
  node.position.fromArray(entry.position);
  node.rotationQuaternion = entry.rotationQuaternion ? Quaternion.FromArray(entry.rotationQuaternion) : null;
  node.rotation.fromArray(entry.rotation ?? [0, 0, 0]);
  node.scaling.fromArray(entry.scaling ?? [1, 1, 1]);
  node.setPivotMatrix(entry.pivotMatrix ? Matrix.FromArray(entry.pivotMatrix) : Matrix.Identity(), false);
  node.setEnabled(entry.enabled !== false);
  for (const [key, [name, fallback]] of Object.entries(PROPERTIES)) if (name in node) node[name] = entry.set?.[key] ?? fallback;
  if (node.getClassName() !== 'TransformNode') node.alphaIndex = entry.alphaIndex ?? Number.MAX_VALUE;
  if (entry.material !== undefined) node.material = made.materialsByKey[entry.material] ?? null;
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
    node = entry.type === 'LinesMesh' ? parsers.linesMesh(entry, entry.name, made) : new Mesh(entry.name, scene);
    if (entry.color) node.color = Color3.FromArray(entry.color);
    if (entry.alpha !== undefined) node.alpha = entry.alpha;
    if (entry.unIndexed) node.isUnIndexed = true;
    if (entry.geometry !== undefined) made.geometries[entry.geometry].applyToMesh(node);
  }
  place(node, entry, made);
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
 * An animation group's entry: its settings with the tracks each datablock gives it (`animations`: by datablock, then by
 * group key), its packed bone tracks one table, or a list of them.
 * @param {string} key @param {Record<string, any>} settings @param {Tables | undefined} animations
 */
export function groupEntry(key, settings, animations) {
  const parts = Object.values(animations ?? {}).map((byGroup) => byGroup[key]).filter(Boolean);
  const tables = parts.flatMap((part) => part.bylonderTracks ?? []);
  return { ...settings, targetedAnimations: parts.flatMap((part) => part.targetedAnimations), ...(tables.length && { bylonderTracks: tables.length === 1 ? tables[0] : tables }) };
}

/** A table's changed keys in the order their objects are made: the world's material first, as materials built before the
 * scene has an environment leave its light out (`parsers.worldMade` makes it). @param {string} table @param {Set<string> | undefined} keys */
const ordered = (table, keys) => [...(keys ?? [])].sort((a, b) => (table === 'materials' ? Number(b.startsWith('WO:')) - Number(a.startsWith('WO:')) : 0));

/** The tables with a patch's entries in them, null ones removed. @param {Tables} tables @param {Tables} patch */
const merged = (tables, patch) => Object.fromEntries([...new Set([...Object.keys(tables), ...Object.keys(patch)])].map((table) => {
  const entries = { ...tables[table], ...patch[table] };
  for (const [key, entry] of Object.entries(patch[table] ?? {})) if (entry === null) delete entries[key];
  return [table, entries];
}));

/**
 * Every key, unique id and buffer the tables' entries name that they would not hold, as messages; buffers only of what
 * `patch` brings.
 * @param {Tables} tables @param {import('./buffers.js').Buffers} buffers @param {Tables} patch
 */
function missing(tables, buffers, patch) {
  const has = (/** @type {string} */ table, /** @type {any} */ key) => key === undefined || key === null || key in (tables[table] ?? {});
  const placed = (/** @type {any} */ key) => key === undefined || key === null || PLACED.some((table) => key in (tables[table] ?? {}));
  const problems = [];
  for (const [key, entry] of Object.entries(tables.nodes ?? {})) {
    if (!has('materials', entry.material) && !has('multiMaterials', entry.material)) problems.push(`nodes ${key}: material ${entry.material}`);
    if (!has('geometries', entry.geometry)) problems.push(`nodes ${key}: geometry ${entry.geometry}`);
    if (!has('morphTargets', entry.morphTargets)) problems.push(`nodes ${key}: morph targets ${entry.morphTargets}`);
  }
  for (const table of ['nodes', 'lights', 'cameras']) for (const [key, entry] of Object.entries(tables[table] ?? {})) {
    if (!placed(entry.parent)) problems.push(`${table} ${key}: parent ${entry.parent}`);
    if (!placed(entry.parentBone?.mesh)) problems.push(`${table} ${key}: bone's mesh ${entry.parentBone.mesh}`);
  }
  for (const [key, multi] of Object.entries(tables.multiMaterials ?? {})) for (const slot of multi.materialsUniqueIds ?? []) if (!has('materials', slot)) problems.push(`multiMaterials ${key}: material ${slot}`);
  const text = JSON.stringify(patch);
  for (const [, buffer] of text.matchAll(/"((?:f32|u16|u32|i32|u8|i8|i16)\.[0-9a-z]+)"/g)) if (!(buffer in buffers)) problems.push(`buffer ${buffer}`);
  return problems;
}

/**
 * The scene's tables and the objects made from them, which `apply(patch)` changes all or nothing: a patch from another
 * version than the one shown, or naming what the tables would not hold, throws and changes nothing (its caller loads
 * the package again). `parsers.worldMade(material)` runs once the world's material is made, before the other materials;
 * `parsers.lightsMade(lights)` once the lights and shadows are made. Gives `made`: the objects
 * by table and key, the materials and multi-materials by key, and the nodes by their exported unique ids.
 * @param {Loading} loading
 */
export function sceneTables(loading) {
  const { scene, lookup, buffers, parsers } = loading;
  /** @type {Tables} */
  let tables = {};
  /** @type {string | null} */
  let version = null;
  /** @type {Record<string, any>} */
  const made = { ...Object.fromEntries(TABLES.map((table) => [table, {}])), materialsByKey: {} };
  /** A node, light or camera by its key. @param {string} key */
  const placedAt = (key) => made.nodes[key] ?? made.lights[key] ?? made.cameras[key] ?? null;

  /** What a changed entry brings with it: what is made from the objects it replaces. @param {Tables} next @param {Map<string, Set<string>>} changed */
  const dependents = (next, changed) => {
    const mark = (/** @type {string} */ table, /** @type {string} */ key) => (changed.get(table) ?? changed.set(table, new Set()).get(table))?.add(key);
    const has = (/** @type {string} */ table) => (changed.get(table)?.size ?? 0) > 0;
    for (const key of changed.get('lights') ?? []) if (next.shadowGenerators?.[`${key}/shadows`]) mark('shadowGenerators', `${key}/shadows`);
    for (const [key, multi] of Object.entries(next.multiMaterials ?? {})) if (multi.materialsUniqueIds?.some((/** @type {string} */ m) => changed.get('materials')?.has(m))) mark('multiMaterials', key);
    for (const [key, entry] of Object.entries(next.nodes ?? {})) {
      if (changed.get('geometries')?.has(entry.geometry) || changed.get('morphTargets')?.has(entry.morphTargets) || (entry.skeleton !== undefined && has('skeletons'))) mark('nodes', key);
    }
    // Groups target the nodes, bones and lights they animate: what is made again takes its animation again.
    const animated = new Set([...changed.get('animations') ?? []].flatMap((id) => Object.keys({ ...tables.animations?.[id], ...next.animations?.[id] })));
    const remade = ['nodes', 'lights', 'cameras', 'skeletons', 'morphTargets'].some((table) => [...changed.get(table) ?? []].some((key) => !keeps(next, table, key)));
    for (const key of Object.keys(next.animationGroups ?? {})) if (remade || animated.has(key)) mark('animationGroups', key);
  };
  /** Whether a node's patch keeps its object, changing only what `place` sets. @param {Tables} next @param {string} table @param {string} key */
  const keeps = (next, table, key) => table === 'nodes' && !!made.nodes[key] && !!next.nodes?.[key] && MADE_WITH.every((field) => same(tables.nodes?.[key]?.[field], next.nodes[key][field]));

  /** @param {string} table @param {string} key @param {any} entry @param {Tables} next */
  const make = (table, key, entry, next) => {
    if (table === 'nodes') return node(loading, entry, made);
    if (table === 'geometries') return geometry(scene, entry, key, buffers);
    return parsers[table](table === 'animationGroups' ? groupEntry(key, entry, next.animations) : entry, key, made);
  };
  /** Each object's own entry in `made`. @param {string} table @param {string} key @param {any} object @param {any} entry */
  const index = (table, key, object, entry) => {
    made[table][key] = object;
    if (table === 'materials' || table === 'multiMaterials') made.materialsByKey[key] = object;

  };
  const unindex = (/** @type {string} */ table, /** @type {string} */ key, /** @type {any} */ entry) => {
    delete made[table][key];
    if (table === 'materials' || table === 'multiMaterials') delete made.materialsByKey[key];

  };

  /** Parents, bones, pose matrices, materials, and the meshes lights leave out or light alone, for what `fresh` holds. @param {Tables} next @param {Set<any>} fresh */
  const link = (next, fresh) => {
    for (const table of PLACED) for (const [key, entry] of Object.entries(next[table] ?? {})) {
      const object = placedAt(key);
      if (entry.parent !== undefined) object.parent = placedAt(entry.parent);
      if (table === 'nodes' && entry.material !== undefined) object.material = made.materialsByKey[entry.material] ?? null;
      if (!fresh.has(object)) continue;
      if (entry.parentBone) object.attachToBone(lookup.getSkeletonById(entry.parentBone.skeletonId)?.bones[entry.parentBone.index], placedAt(entry.parentBone.mesh));
      if (entry.poseMatrix) object.updatePoseMatrix(Matrix.FromArray(entry.poseMatrix));
    }
    const meshes = (/** @type {string[]} */ ids) => ids.map((id) => lookup.getMeshById(id)).filter(Boolean);
    for (const [key, entry] of Object.entries(next.lights ?? {})) {
      const light = placedAt(key);
      if (!fresh.has(light)) continue;
      if (entry.excludedMeshesIds?.length) light.excludedMeshes = meshes(entry.excludedMeshesIds);
      if (entry.includedOnlyMeshesIds?.length) light.includedOnlyMeshes = meshes(entry.includedOnlyMeshesIds);
    }
  };

  return {
    made,
    get tables() { return tables; },
    get version() { return version; },
    /**
     * Applies a patch, all or nothing: one that fails leaves the scene as it was, unless the error says `reload` (it
     * failed once objects were swapped in), when only loading the package again gives a whole scene. Gives the keys it
     * changed, by table.
     * @param {Patch} patch
     */
    apply(patch) {
      if (version !== null && patch.base !== version) throw new Error(`A patch from version ${patch.base} does not apply to version ${version}`);
      const added = Object.keys(patch.buffers ?? {}).filter((key) => !(key in buffers));
      Object.assign(buffers, patch.buffers);
      const next = merged(tables, patch.tables), problems = missing(next, buffers, patch.tables);
      if (problems.length) {
        for (const key of added) delete buffers[key];
        throw new Error(`A patch names what the scene would not hold: ${problems.slice(0, 8).join(', ')}`);
      }
      const changed = new Map(Object.entries(patch.tables).map(([table, entries]) => [table, new Set(Object.keys(entries))]));
      dependents(next, changed);
      /** @type {[string, string, any, any][]} */
      const replaced = [];
      const fresh = new Set();
      let reset = false;
      try {
        for (const table of TABLES) for (const key of ordered(table, changed.get(table))) {
          const entry = next[table]?.[key];
          if (keeps(next, table, key)) continue;
          replaced.push([table, key, made[table][key], tables[table]?.[key]]);
          // A group made again starts from what its targets are without it: Babylon takes their values as it starts.
          if (table === 'animationGroups' && made[table][key]) { made[table][key].reset(); reset = true; }
          if (made[table][key]) unindex(table, key, tables[table]?.[key]);
          if (!entry) continue;
          const object = make(table, key, entry, next);
          fresh.add(object);
          index(table, key, object, entry);
          if (table === 'materials' && key.startsWith('WO:')) parsers.worldMade?.(object, key, made);
        }
      } catch (error) {
        for (const object of fresh) object.dispose?.();
        for (const [table, key, object, entry] of replaced.reverse()) { unindex(table, key, null); if (object) index(table, key, object, entry); }
        for (const key of added) delete buffers[key];
        // A group reset to make its new one has let go of its targets: the scene is no longer as it was.
        throw Object.assign(/** @type {Error} */ (error), { reload: reset });
      }
      try {
        for (const key of changed.get('nodes') ?? []) if (keeps(next, 'nodes', key)) place(made.nodes[key], next.nodes[key], made);
        for (const [key, entry] of Object.entries(next.nodes ?? {})) if (!fresh.has(made.nodes[key])) {
          const object = made.nodes[key];
          if (changed.get('geometries')?.has(entry.geometry)) made.geometries[entry.geometry].applyToMesh(object);
          if (entry.morphTargets !== undefined) object.morphTargetManager = made.morphTargets[entry.morphTargets];
        }
        link(next, fresh);
        if (changed.get('lights')?.size || changed.get('nodes')?.size || version === null) parsers.lightsMade?.(Object.values(made.lights), '', made);
      } catch (error) {
        // Objects were swapped in and changed: only loading the package again gives a whole scene.
        throw Object.assign(/** @type {Error} */ (error), { reload: true });
      }
      // What was replaced goes once nothing points at it: a node alone, its children having moved to the new one.
      for (const [table, , object] of replaced) if (object) table === 'nodes' ? object.dispose(true) : object.dispose?.();
      tables = next;
      version = patch.version ?? null;
      return changed;
    },
  };
}

/**
 * Applies `tables` to an empty scene, as the full patch of a package. Gives what it made (sceneTables `made`), with the
 * tables' state as `state`.
 * @param {Loading} loading @param {Tables} tables @param {string | null} [version]
 */
export function loadTables(loading, tables, version = null) {
  const state = sceneTables(loading);
  state.apply({ base: null, version, tables });
  return Object.assign(state.made, { state });
}
