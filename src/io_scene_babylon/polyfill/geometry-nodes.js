// Blender's Geometry Nodes module for an exported page's evaluator (runtime/geometry-nodes-evaluator.js): instantiated
// from its URL, giving its exports as the kernels call them. Bundled into geometry-nodes-kernels.bundle.js by
// scripts/modifiers-polyfill.mjs, a package's bylonder-geometry-nodes/kernels.js.
import { instantiate as load } from '../../port/wasm.js';

export const instantiate = async (url) => (await load(url)).exports;
