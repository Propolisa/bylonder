// Blender's modules a JavaScript package can ship (runtime-files.js gplFiles), by src/ path: their URLs as the app
// serves them.
import { GEOMETRY_NODES_KERNELS } from './runtime-files.js';

export const MODULES = {
  'modifiers/modifiers.wasm': async () => (await import('../modifiers/modifiers.wasm?url')).default,
  'bmesh/bmesh.wasm': async () => (await import('../bmesh/bmesh-module.js')).BMESH_WASM,
};

// The bytes of the Geometry Nodes kernels a package ships, where the server states them, or null.
export async function geometryNodesKernelsSize() {
  const response = await fetch(await MODULES[GEOMETRY_NODES_KERNELS](), { method: 'HEAD' }).catch(() => null);
  return Number(response?.headers.get('content-length')) || null;
}
