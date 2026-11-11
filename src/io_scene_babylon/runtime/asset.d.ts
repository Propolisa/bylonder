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
export function addAsset<Controller>(scene: Scene, build: (scene: Scene, lookup: Scene) => void, { root, controller }: {
    root?: import("@babylonjs/core").TransformNode | null;
    controller: (view: Scene, entries: Entries, dispose: () => void) => Controller;
}): Controller;
/**
 * A copy of loaded objects, as AssetContainer.instantiateModelsToScene makes a .glb's: their nodes, skeletons and
 * animation cloned, sharing geometry, materials and textures, under a "__root__" of its own (itself under `root` if
 * given), with a controller of its own.
 * @template Controller
 * @param {Entries} entries what the copy is made of
 * @param {{ root?: import('@babylonjs/core').TransformNode | null,
 *   controller: (view: Scene, entries: Entries, dispose: () => void) => Controller }} options
 */
export function cloneAsset<Controller>(entries: Entries, { root, controller }: {
    root?: import("@babylonjs/core").TransformNode | null;
    controller: (view: Scene, entries: Entries, dispose: () => void) => Controller;
}): Controller;
/**
 * Loaded objects in an AssetContainer, as LoadAssetContainerAsync gives a .glb's: out of the scene until addAllToScene,
 * with `blend`, their controller; `instantiate()` makes a copy of them (cloneAsset) in the scene.
 * @template {{ entries?: Entries }} Controller
 * @param {Controller} blend
 * @param {(root?: import('@babylonjs/core').TransformNode) => Promise<Controller>} instantiate
 */
export function assetContainer<Controller extends {
    entries?: Entries;
}>(blend: Controller, instantiate: (root?: import("@babylonjs/core").TransformNode) => Promise<Controller>): AssetContainer & {
    blend: Controller;
    instantiate: (root?: import("@babylonjs/core").TransformNode) => Promise<Controller>;
};
/**
 * What one load added to a scene, as ImportMeshAsync gives a .glb's: meshes[0] is the root.
 */
export type Entries = Content & {
    root: import("@babylonjs/core").TransformNode;
};
export type Scene = import("@babylonjs/core").Scene;
export type Node = import("@babylonjs/core").Node;
/**
 * What one build added to the scene, by list.
 */
export type Content = { [K in (typeof LISTS)[number]]: any[]; };
import { AssetContainer } from '@babylonjs/core';
/** @typedef {import('@babylonjs/core').Scene} Scene */
/** @typedef {import('@babylonjs/core').Node} Node */
declare const LISTS: readonly ["meshes", "transformNodes", "lights", "cameras", "materials", "multiMaterials", "skeletons", "morphTargetManagers", "animationGroups", "particleSystems", "textures", "geometries"];
export {};
