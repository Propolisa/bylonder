/**
 * The module's exports the kernels use.
 * @typedef {{ memory: WebAssembly.Memory, malloc(size: number): number, free(pointer: number): void, gn_eval(request: number): number,
 *   gn_id_define(json: number): void, gn_result_free(): void }} Exports
 * An ID a fragment reads, as `resolve` gives it: a material, an object with its world matrix (by columns), its IR
 * geometry and materials, or a collection with its objects' and child collections' keys.
 * @typedef {{ type: 'MATERIAL' } | { type: 'OBJECT', matrix: number[], geometry?: any, materials?: any[] } | { type: 'COLLECTION', objects: string[], children?: string[], instance_offset?: number[] }} ResolvedID
 */
/**
 * The kernels of a loaded module, as a unit for any node type.
 * @param {Exports} x
 * @param {(key: string) => ResolvedID | null} resolve
 */
export function createKernels(x: Exports, resolve: (key: string) => ResolvedID | null): {
    unit: import("../units.js").Unit & {
        kernel: true;
    };
    define: (key: string) => void;
};
/**
 * An ID a fragment reads, as `resolve` gives it: a material, an object with its world matrix (by columns), its IR
 * geometry and materials, or a collection with its objects' and child collections' keys.
 */
export type Exports = {
    memory: WebAssembly.Memory;
    malloc(size: number): number;
    free(pointer: number): void;
    gn_eval(request: number): number;
    gn_id_define(json: number): void;
    gn_result_free(): void;
};
/**
 * The module's exports the kernels use.
 */
export type ResolvedID = {
    type: "MATERIAL";
} | {
    type: "OBJECT";
    matrix: number[];
    geometry?: any;
    materials?: any[];
} | {
    type: "COLLECTION";
    objects: string[];
    children?: string[];
    instance_offset?: number[];
};
