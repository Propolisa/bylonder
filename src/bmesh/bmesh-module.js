// Where Blender's module is, for the realm that instantiates it (bmesh-wasm.js) and for workers given it compiled.
// BYLONDER_BMESH_WASM (Node) names another build of it, for the module build's check (tools/blender-port/check-bmesh.mjs).
const other = globalThis.process?.env?.BYLONDER_BMESH_WASM;
export const BMESH_WASM = other ? new URL(`file://${other}`) : new URL('./bmesh.wasm', import.meta.url);
