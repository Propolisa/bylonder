/**
 * The `modifier:NODES` unit over an IR's graphs. Its entity's inputs: `graph` (the graph or its key), `geometry` and
 * each interface input by identifier; its output `geometry`.
 * @param {Record<string, import('../ir.js').Graph>} graphs
 * `units` are the caller's node units, tried after the registry's and before the kernels.
 * @param {{ kernels?: import('../units.js').Unit, units?: Record<string, import('../units.js').Unit>, resolve?: (key: string) => any }} [options]
 * @returns {import('../units.js').Unit}
 */
export function geometryNodesUnit(graphs: Record<string, import("../ir.js").Graph>, { kernels, units, resolve }?: {
    kernels?: import("../units.js").Unit;
    units?: Record<string, import("../units.js").Unit>;
    resolve?: (key: string) => any;
}): import("../units.js").Unit;
