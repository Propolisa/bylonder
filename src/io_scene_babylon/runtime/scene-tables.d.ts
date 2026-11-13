/**
 * An animation group's entry: its settings with the tracks each datablock gives it (`animations`: by datablock, then by
 * group key), its packed bone tracks one table, or a list of them.
 * @param {string} key @param {Record<string, any>} settings @param {Tables | undefined} animations
 */
export function groupEntry(key: string, settings: Record<string, any>, animations: Tables | undefined): {
    bylonderTracks?: any;
    targetedAnimations: any[];
};
/**
 * Applies `patch` to an empty scene: each table's entries made in order, then linked. `parsers.lightsMade(lights)` runs
 * once the lights and shadows are made; a parser finds what it links to in `made`. Gives what it made, by table and key,
 * the materials and multi-materials by key, and the nodes by their exported unique ids.
 * @param {Loading} loading @param {Tables} patch
 */
export function loadTables(loading: Loading, patch: Tables): Record<string, any>;
/**
 * @typedef {Record<string, Record<string, any>>} Tables a table's entries by key, each table by name
 * @typedef {Record<string, (entry: any, key: string, made: Record<string, any>) => any>} Parsers what makes a table's entry, by table
 *   name, given what is made so far
 * @typedef {{ scene: import('@babylonjs/core').Scene, lookup: import('@babylonjs/core').Scene, buffers: import('./buffers.js').Buffers, parsers: Parsers }} Loading
 */
/** The tables in the order their entries are made. */
export const TABLES: string[];
/**
 * a table's entries by key, each table by name
 */
export type Tables = Record<string, Record<string, any>>;
/**
 * what makes a table's entry, by table
 *   name, given what is made so far
 */
export type Parsers = Record<string, (entry: any, key: string, made: Record<string, any>) => any>;
export type Loading = {
    scene: import("@babylonjs/core").Scene;
    lookup: import("@babylonjs/core").Scene;
    buffers: import("./buffers.js").Buffers;
    parsers: Parsers;
};
