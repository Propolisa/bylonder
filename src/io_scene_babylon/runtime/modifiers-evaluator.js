// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// The `modifiers` evaluator of the dependency table: an object's Blender mesh modifiers, run by modifiers.wasm in a
// worker (bylonder-modifiers/: the module and its worker, GPL, shipped with Live Modifiers). Loaded on the first set of
// a modifier setting; each operation is one object's stack on its base Mesh in scene.bin, and its result replaces the
// object's geometry, the newest settings winning while one evaluates.

/** The worker's draw buffers by Babylon's vertex kinds. */
const KINDS = { positions: 'position', normals: 'normal', uvs: 'uv' };

/**
 * A setting as Blender takes it: an integer one rounded, as Blender's animation of it rounds.
 * @param {Record<string, any>} layouts
 * @param {string} path
 * @param {any} value
 */
function setting(layouts, path, value) {
  const layout = layouts[/** @type {string} */ (/^\w+/.exec(path)?.[0])];
  return typeof value === 'number' && layout && layout.kind !== 'float' && !layout.boolean ? Math.round(value) : value;
}

/** @param {import('./scheduler.js').Page} page @returns {Promise<import('./scheduler.js').Evaluator>} */
export async function load({ scene, root, buffers }) {
  const worker = new Worker(new URL('bylonder-modifiers/modifiers-worker.js', root), { type: 'module' });
  worker.postMessage({ wasm: new URL('bylonder-modifiers/modifiers.wasm', root).href });
  /** @type {Map<number, { resolve(buffers: Record<string, any>): void, reject(error: Error): void }>} */
  const replies = new Map();
  let next = 0;
  worker.onmessage = ({ data }) => {
    const reply = replies.get(data.id);
    replies.delete(data.id);
    if (data.error) reply?.reject(new Error(data.error));
    else reply?.resolve(data.buffers);
  };
  /** @param {any} base @param {any[]} stack @returns {Promise<Record<string, any>>} */
  const evaluate = (base, stack) => new Promise((resolve, reject) => {
    replies.set(next, { resolve, reject });
    worker.postMessage({ id: next++, base, stack });
  });

  /** Each operation's evaluation going, and the settings to evaluate after it. */
  const running = new Map(), queued = new Map();
  /** @param {import('./scheduler.js').Operation} operation */
  const start = (operation) => {
    const { node, base, stack } = operation.data, settings = queued.get(operation);
    queued.delete(operation);
    const arrays = Object.fromEntries(Object.entries(base).map(([name, index]) => [name, buffers[/** @type {number} */ (index)]]));
    running.set(operation, evaluate(arrays, settings).then((result) => {
      const mesh = /** @type {import('@babylonjs/core').Mesh | null} */ (scene.getMeshById(node));
      if (!mesh || mesh.isDisposed()) return;
      mesh.makeGeometryUnique();
      for (const [name, kind] of Object.entries(KINDS)) if (result[name]) mesh.setVerticesData(kind, result[name], false);
      mesh.setIndices(result.indices);
      mesh.refreshBoundingInfo();
    }, (error) => console.warn(`${node}: ${error.message}`)).finally(() => {
      running.delete(operation);
      if (queued.has(operation)) start(operation);
    }));
  };

  return {
    run(operation, read) {
      queued.set(operation, operation.data.stack.map((/** @type {any} */ { type, layouts, values }) => ({
        type, layouts, values: Object.fromEntries(Object.entries(values).map(([path, index]) => [path, setting(layouts, path, read(/** @type {number} */ (index)))])),
      })));
      if (!running.has(operation)) start(operation);
      return [];
    },
    async settled() {
      while (running.size) await Promise.all(running.values());
    },
  };
}
