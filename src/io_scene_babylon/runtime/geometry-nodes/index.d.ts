/**
 * The `modifier:NODES` unit over an IR's graphs. Its entity's inputs: `graph` (the graph or its key), `geometry` and
 * each interface input by identifier; its output `geometry`.
 * @param {Record<string, import('../ir.js').Graph>} graphs
 * @param {{ kernels?: import('../units.js').Unit, resolve?: (key: string) => any }} [options]
 * @returns {import('../units.js').Unit}
 */
export function geometryNodesUnit(graphs: Record<string, import("../ir.js").Graph>, { kernels, resolve }?: {
    kernels?: import("../units.js").Unit;
    resolve?: (key: string) => any;
}): import("../units.js").Unit;
