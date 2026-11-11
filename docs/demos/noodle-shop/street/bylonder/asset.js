// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// A package loaded as an asset into a scene of the page's own, as a glTF file loads: its objects under a root node,
// "__root__", turned as glTF's loader turns its root so the asset faces as a .glb exported from the same .blend does,
// with no scene-wide settings (world, camera effects, compositor). Each copy has its own controller.
import { AssetContainer } from '@babylonjs/core/assetContainer.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { Quaternion } from '@babylonjs/core/Maths/math.vector.js';
import { isClip } from './clips.js';
import { sceneLights } from './overrides/babylon/clustered-lights.js';

/** @typedef {import('@babylonjs/core').Scene} Scene */
/** @typedef {import('@babylonjs/core').Node} Node */

// The scene's lists an asset adds to.
const LISTS = /** @type {const} */ (['meshes', 'transformNodes', 'lights', 'cameras', 'materials', 'multiMaterials', 'skeletons', 'morphTargetManagers',
  'animationGroups', 'particleSystems', 'textures', 'geometries']);

/**
 * What one build added to the scene, by list.
 * @typedef {{ [K in typeof LISTS[number]]: any[] }} Content
 */

/** @param {Scene} scene */
const lists = (scene) => /** @type {Record<string, any[]>} */ (/** @type {unknown} */ (scene));
/** @param {any[]} list @param {(item: any) => boolean} test */
const newest = (list, test) => { for (let i = list.length - 1; i >= 0; i--) if (test(list[i])) return list[i]; return null; };

/**
 * The scene as a build's Parse calls see it: a lookup by id finds the newest match, the build's own while it runs
 * synchronously, so copies of one asset in one scene do not find each other's objects.
 * @param {Scene} scene
 */
function newestFirst(scene) {
  // Bones too, as Scene.getNodeById finds them: a skeleton's animation targets its bones by id.
  const nodes = () => [...scene.meshes, ...scene.transformNodes, ...sceneLights(scene), ...scene.cameras, ...scene.skeletons.flatMap((s) => s.bones)];
  /** @param {string} id */
  const morphTarget = (id) => {
    for (const manager of [...scene.morphTargetManagers].reverse()) for (let i = 0; i < manager.numTargets; i++) if (manager.getTarget(i).id === id) return manager.getTarget(i);
    return null;
  };
  return lookups(scene, {
    getNodeById: (/** @type {string} */ id) => newest(nodes(), (n) => n.id === id),
    getMeshById: (/** @type {string} */ id) => newest(scene.meshes, (n) => n.id === id),
    getLightById: (/** @type {string} */ id) => newest(sceneLights(scene), (n) => n.id === id),
    getCameraById: (/** @type {string} */ id) => newest(scene.cameras, (n) => n.id === id),
    getSkeletonById: (/** @type {string} */ id) => newest(scene.skeletons, (n) => n.id === id),
    getMorphTargetById: morphTarget,
  });
}

/**
 * The scene with some of its members replaced: the others read from the scene, its methods bound to it.
 * @param {Scene} scene
 * @param {Record<string, any>} own
 * @returns {Scene}
 */
function lookups(scene, own) {
  const bound = new Map();
  return new Proxy(scene, {
    get(target, key) {
      if (key in own) return own[/** @type {string} */ (key)];
      const value = Reflect.get(target, key);
      if (typeof value !== 'function') return value;
      if (!bound.has(key)) bound.set(key, value.bind(target));
      return bound.get(key);
    },
  });
}

/**
 * The scene as one copy's controller sees it: its lists and lookups by id hold that copy's objects alone.
 * @param {Scene} scene
 * @param {Content} content
 */
function scoped(scene, content) {
  const nodes = [...content.meshes, ...content.transformNodes, ...content.lights, ...content.cameras, ...content.skeletons.flatMap((s) => s.bones)];
  /** @param {any[]} list */
  const byId = (list) => (/** @type {string} */ id) => list.find((n) => n.id === id) ?? null;
  return lookups(scene, {
    ...content,
    getNodeById: byId(nodes), getMeshById: byId(content.meshes), getTransformNodeById: byId(content.transformNodes), getLightById: byId(content.lights),
    getCameraById: byId(content.cameras), getMaterialById: byId(content.materials), getSkeletonById: byId(content.skeletons),
  });
}

/**
 * The root an asset's objects hang from: glTF's turn into a left-handed scene (half a turn about Y), a mirror of Z into a
 * right-handed one.
 * @param {Scene} scene
 */
function assetRoot(scene) {
  const root = new Mesh('__root__', scene);
  if (scene.useRightHandedSystem) root.scaling.z = -1;
  else root.rotationQuaternion = new Quaternion(0, 1, 0, 0);
  return root;
}

// A node hung from a bone (attachToBone), as an object parented to a bone is: no descendant of the root.
const onBone = (/** @type {Node} */ node) => node.parent?.getClassName() === 'Bone';

/**
 * What one load added to a scene, as ImportMeshAsync gives a .glb's: meshes[0] is the root.
 * @typedef {Content & { root: import('@babylonjs/core').TransformNode }} Entries
 */

/**
 * Adds the objects `build` makes into `scene` under "__root__", turned as glTF's loader turns its root, itself under
 * `root` (a node of the page's own) if given. `build` adds them synchronously, finding them by id with the scene it is given;
 * `controller` makes their controller from a view of the scene holding them alone, given what they are and what
 * removes them.
 * @template Controller
 * @param {Scene} scene
 * @param {(scene: Scene, lookup: Scene) => void} build
 * @param {{ root?: import('@babylonjs/core').TransformNode | null,
 *   controller: (view: Scene, entries: Entries, dispose: () => void) => Controller }} options
 */
export function addAsset(scene, build, { root = null, controller }) {
  const before = new Map(LISTS.map((list) => [list, new Set(lists(scene)[list])]));
  build(scene, newestFirst(scene));
  const content = /** @type {Content} */ (Object.fromEntries(LISTS.map((list) => [list, lists(scene)[list].filter((item) => !before.get(list)?.has(item))])));
  const top = assetRoot(scene);
  for (const node of [...content.meshes, ...content.transformNodes, ...content.lights, ...content.cameras]) if (!node.parent) node.parent = top;
  top.parent = root;
  content.meshes.unshift(top);
  const dispose = () => {
    for (const group of content.animationGroups) group.dispose();
    for (const system of content.particleSystems) system.dispose();
    for (const node of [...content.meshes, ...content.transformNodes].filter(onBone)) node.dispose();
    for (const skeleton of content.skeletons) skeleton.dispose();
    top.dispose(false, true);
  };
  return controller(scoped(scene, content), { ...content, root: top }, dispose);
}

/**
 * A copy of loaded objects, as AssetContainer.instantiateModelsToScene makes a .glb's: their nodes, skeletons and
 * animation cloned, sharing geometry, materials and textures, under a "__root__" of its own (itself under `root` if
 * given), with a controller of its own.
 * @template Controller
 * @param {Entries} entries what the copy is made of
 * @param {{ root?: import('@babylonjs/core').TransformNode | null,
 *   controller: (view: Scene, entries: Entries, dispose: () => void) => Controller }} options
 */
export function cloneAsset(entries, { root = null, controller }) {
  const scene = entries.root.getScene(), source = new AssetContainer(scene);
  for (const list of LISTS) lists(/** @type {any} */ (source))[list]?.push(...entries[list]);
  const made = source.instantiateModelsToScene((name) => name, false, { doNotInstantiate: true });
  const top = /** @type {any} */ (made.rootNodes[0]), ids = new Map(entries.meshes.concat(entries.transformNodes).map((n) => [n.name, n.id]));
  const nodes = [top, ...top.getDescendants(false)], /** @type {Node[]} */ onBones = [];
  // Nodes on bones, with what hangs from them, hung from the copy's bones.
  for (const node of [...entries.meshes, ...entries.transformNodes].filter(onBone)) {
    const bone = node.parent, skeleton = made.skeletons[entries.skeletons.indexOf(bone.getSkeleton())];
    const copy = node.clone(node.name, null), skinned = nodes.find((n) => n.name === node._transformToBoneReferal?.name);
    onBones.push(copy.attachToBone(skeleton.bones[bone.getIndex()], skinned));
    nodes.push(copy, ...copy.getDescendants(false));
  }
  for (const node of nodes) node.id = ids.get(node.name) ?? node.id;
  // Held at their frame by the copy's playhead, as the loaded ones are; clips wait to be played.
  for (const group of made.animationGroups) if (!isClip(group)) group.start(group.loopAnimation).pause();
  top.parent = root;
  const content = { ...Object.fromEntries(LISTS.map((list) => [list, []])), meshes: nodes.filter((n) => n.getClassName().endsWith('Mesh')),
    transformNodes: nodes.filter((n) => n.getClassName() === 'TransformNode'), materials: entries.materials, multiMaterials: entries.multiMaterials,
    textures: entries.textures, geometries: entries.geometries, skeletons: made.skeletons, animationGroups: made.animationGroups };
  const dispose = () => {
    made.animationGroups.forEach((group) => group.dispose());
    made.skeletons.forEach((skeleton) => skeleton.dispose());
    onBones.forEach((node) => node.dispose());
    top.dispose();
  };
  return controller(scoped(scene, /** @type {Content} */ (content)), /** @type {Entries} */ ({ ...content, root: top }), dispose);
}

/**
 * Loaded objects in an AssetContainer, as LoadAssetContainerAsync gives a .glb's: out of the scene until addAllToScene,
 * with `blend`, their controller; `instantiate()` makes a copy of them (cloneAsset) in the scene.
 * @template {{ entries?: Entries }} Controller
 * @param {Controller} blend
 * @param {(root?: import('@babylonjs/core').TransformNode) => Promise<Controller>} instantiate
 */
export function assetContainer(blend, instantiate) {
  const entries = /** @type {Entries} */ (blend.entries), container = new AssetContainer(entries.root.getScene());
  for (const list of LISTS) lists(/** @type {any} */ (container))[list]?.push(...entries[list]);
  container.removeAllFromScene();
  return Object.assign(container, { blend, instantiate });
}
