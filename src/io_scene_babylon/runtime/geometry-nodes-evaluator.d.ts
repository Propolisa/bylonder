/**
 * The IDs a graph reads, by IR key, as the kernels take them.
 * @param {import('./ir.js').IR} ir
 * @param {import('./buffers.js').Buffers} buffers
 * @returns {(key: string) => import('./geometry-nodes/kernels.js').ResolvedID | null}
 */
export function idResolver(ir: import("./ir.js").IR, buffers: import("./buffers.js").Buffers): (key: string) => import("./geometry-nodes/kernels.js").ResolvedID | null;
/**
 * The `modifier:NODES` unit of an IR, its kernels in `exports` (a loaded Geometry Nodes module).
 * @param {import('./ir.js').IR} ir
 * @param {import('./buffers.js').Buffers} buffers
 * @param {import('./geometry-nodes/kernels.js').Exports} [exports] none when units run every node
 */
export function geometryNodes(ir: import("./ir.js").IR, buffers: import("./buffers.js").Buffers, exports?: import("./geometry-nodes/kernels.js").Exports): import("./units.js").Unit<Record<string, any>>;
/** @param {import('./scheduler.js').Page} page @returns {Promise<import('./scheduler.js').Evaluator>} */
export function load({ root, ir, buffers }: import("./scheduler.js").Page): Promise<import("./scheduler.js").Evaluator>;
