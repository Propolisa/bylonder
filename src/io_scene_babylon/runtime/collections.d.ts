/** @typedef {import('./ir.js').IR} IR */
/** @typedef {'exclude' | 'hide_viewport' | 'hide_render' | 'layer_hide_viewport'} Flag */
/**
 * A collection in the tree: its key, its parent's (null for the scene collection) and its depth.
 * @typedef {{ key: string, parent: string | null, depth: number }} Placed
 */
/**
 * The collections from the scene collection (or `from`) down, depth first in the outliner's order.
 * @param {IR} ir
 * @param {string | null} [from]
 * @returns {Placed[]}
 */
export function collectionTree(ir: IR, from?: string | null): Placed[];
/**
 * A collection's key from its key or name.
 * @param {IR} ir
 * @param {string} collection
 */
export function collectionKey(ir: IR, collection: string): string;
/**
 * The objects a collection holds, and with `recursive` those its child collections hold (Blender's all_objects).
 * @param {IR} ir
 * @param {string} key
 * @param {boolean} [recursive]
 * @returns {string[]}
 */
export function objectsIn(ir: IR, key: string, recursive?: boolean): string[];
/**
 * The IDs a collection's objects use (their data, materials, node groups), with the objects themselves.
 * @param {IR} ir
 * @param {string} key
 */
export function idsIn(ir: IR, key: string): Set<string>;
/**
 * Each object's showing through its collections, by key, from the collections' flags as `flag` gives them; an object
 * linked only to excluded collections does not show.
 * @param {IR} ir
 * @param {(key: string, flag: Flag) => boolean} flag
 */
export function showing(ir: IR, flag: (key: string, flag: Flag) => boolean): Map<string, boolean>;
export type IR = import("./ir.js").IR;
export type Flag = "exclude" | "hide_viewport" | "hide_render" | "layer_hide_viewport";
/**
 * A collection in the tree: its key, its parent's (null for the scene collection) and its depth.
 */
export type Placed = {
    key: string;
    parent: string | null;
    depth: number;
};
