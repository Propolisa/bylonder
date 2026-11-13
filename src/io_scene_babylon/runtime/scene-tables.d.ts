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
 * The scene's tables and the objects made from them, which `apply(patch)` changes all or nothing: a patch from another
 * version than the one shown, or naming what the tables would not hold, throws and changes nothing (its caller loads
 * the package again). `parsers.worldMade(material)` runs once the world's material is made, before the other materials;
 * `parsers.lightsMade(lights)` once the lights and shadows are made. Gives `made`: the objects
 * by table and key, the materials and multi-materials by key, and the nodes by their exported unique ids.
 * @param {Loading} loading
 */
export function sceneTables(loading: Loading): {
    made: Record<string, any>;
    readonly tables: Tables;
    readonly version: string | null;
    /**
     * Applies a patch, all or nothing: one that fails leaves the scene as it was, unless the error says `reload` (it
     * failed once objects were swapped in), when only loading the package again gives a whole scene. Gives the keys it
     * changed, by table.
     * @param {Patch} patch
     */
    apply(patch: Patch): Map<string, Set<string>>;
};
/**
 * Applies `tables` to an empty scene, as the full patch of a package. Gives what it made (sceneTables `made`), with the
 * tables' state as `state`.
 * @param {Loading} loading @param {Tables} tables @param {string | null} [version]
 */
export function loadTables(loading: Loading, tables: Tables, version?: string | null): Record<string, any> & {
    state: {
        made: Record<string, any>;
        readonly tables: Tables;
        readonly version: string | null;
        /**
         * Applies a patch, all or nothing: one that fails leaves the scene as it was, unless the error says `reload` (it
         * failed once objects were swapped in), when only loading the package again gives a whole scene. Gives the keys it
         * changed, by table.
         * @param {Patch} patch
         */
        apply(patch: Patch): Map<string, Set<string>>;
    };
};
/**
 * @typedef {Record<string, Record<string, any>>} Tables a table's entries by key, each table by name
 * @typedef {Record<string, (entry: any, key: string, made: Record<string, any>) => any>} Parsers what makes a table's entry, by table
 *   name, given what is made so far
 * @typedef {{ scene: import('@babylonjs/core').Scene, lookup: import('@babylonjs/core').Scene, buffers: import('./buffers.js').Buffers, parsers: Parsers }} Loading
 * @typedef {{ base?: string | null, version?: string | null, tables: Tables, buffers?: import('./buffers.js').Buffers }} Patch
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
export type Patch = {
    base?: string | null;
    version?: string | null;
    tables: Tables;
    buffers?: import("./buffers.js").Buffers;
};
