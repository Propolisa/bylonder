// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// The `geometry-nodes` implementation of `modifier:NODES` entities: Bylonder's Geometry Nodes evaluator
// (geometry-nodes/) over the IR's graphs, each node through the registry, else through Blender's per-node kernels
// (bylonder-geometry-nodes/: Blender's Geometry Nodes module, GPL, loaded on the first set of an input the entity reads).
// The IDs a graph reads come from the IR: an object's world matrix and geometry as evaluated at export, a collection's
// members.
import { geometryNodesUnit } from './geometry-nodes/index.js';
import { createKernels } from './geometry-nodes/kernels.js';
import { unitNodes } from './geometry-nodes/evaluator.js';
import { unitFor } from './units.js';

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const keys = (/** @type {any[] | undefined} */ list) => (list ?? []).map((item) => item.id);

/**
 * A value with scene.bin's arrays in place of its buffer references.
 * @param {any} value
 * @param {ArrayBufferView[]} buffers
 * @returns {any}
 */
const withBuffers = (value, buffers) => {
  if (value?.constructor !== Object) return value;
  if (typeof value.buffer === 'number') return buffers[value.buffer];
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, withBuffers(v, buffers)]));
};

/**
 * The IDs a graph reads, by IR key, as the kernels take them.
 * @param {import('./ir.js').IR} ir
 * @param {ArrayBufferView[]} buffers
 * @returns {(key: string) => import('./geometry-nodes/kernels.js').ResolvedID | null}
 */
export function idResolver(ir, buffers) {
  return (key) => {
    const id = ir.ids[key], data = id?.data ?? {};
    if (!id) return null;
    switch (key.slice(0, key.indexOf(':'))) {
      case 'MA': return { type: 'MATERIAL' };
      case 'GR': return { type: 'COLLECTION', objects: keys(data.objects), children: keys(data.children), ...(data.instance_offset && { instance_offset: data.instance_offset }) };
      case 'OB': return { type: 'OBJECT', matrix: id.evaluated?.matrix_world ?? IDENTITY, geometry: withBuffers(id.evaluated?.geometry, buffers),
        materials: (data.material_slots ?? []).map((/** @type {any} */ slot) => slot.material ?? null) };
      default: return null;
    }
  };
}

/**
 * The `modifier:NODES` unit of an IR, its kernels in `exports` (a loaded Geometry Nodes module).
 * @param {import('./ir.js').IR} ir
 * @param {ArrayBufferView[]} buffers
 * @param {import('./geometry-nodes/kernels.js').Exports} [exports] none when units run every node
 */
export function geometryNodes(ir, buffers, exports) {
  const resolve = idResolver(ir, buffers);
  return geometryNodesUnit(ir.graphs, { kernels: exports && createKernels(exports, resolve).unit, units: { 'node:GeometryNodeInputSceneTime': sceneTime(ir) }, resolve });
}

/**
 * Scene Time: the frame, and the seconds it is at the scene's frame rate (render fps over fps_base).
 * @param {import('./ir.js').IR} ir
 * @returns {import('./units.js').Unit}
 */
function sceneTime(ir) {
  const render = Object.values(ir.ids).find((id) => id.type === 'SCENE')?.data?.render ?? {};
  const rate = (render.fps ?? 24) / (render.fps_base ?? 1);
  return { run: (_, { frame }) => ({ Seconds: [frame / rate], Frame: [frame] }) };
}

/** @param {import('./scheduler.js').Page} page @returns {Promise<import('./scheduler.js').Evaluator>} */
export async function load({ root, ir, buffers }) {
  // Blender's kernels load only for a node no registered unit runs: a package whose nodes all have units ships none.
  if ([...unitNodes(ir.graphs).keys()].every((type) => unitFor(type))) return geometryNodes(ir, buffers);
  const { instantiate } = await import(new URL('bylonder-geometry-nodes/kernels.js', root).href);
  return geometryNodes(ir, buffers, await instantiate(new URL('bylonder-geometry-nodes/geometry-nodes.wasm', root)));
}
