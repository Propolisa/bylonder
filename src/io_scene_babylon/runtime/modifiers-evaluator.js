// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// The `modifiers` implementation of `modifier:*` entities: Blender's mesh modifiers on an IR mesh, run by modifiers.wasm
// in a worker (bylonder-modifiers/: the module and its worker, GPL, shipped with Live Modifiers), loaded on the first set
// of a modifier setting. A run of a stack's modifiers on it is one call (runChain), so what each writes reaches the next.
// It gives an IR mesh, or the draw buffers when the last one's mesh is drawn, and draws an IR mesh another unit gives as
// Blender draws it.

/**
 * A setting as Blender takes it: an integer one rounded, as Blender's animation of it rounds.
 * @param {Record<string, any>} layouts
 * @param {string} name
 * @param {any} value
 */
function setting(layouts, name, value) {
  const layout = layouts[name];
  return typeof value === 'number' && layout && layout.kind !== 'float' && !layout.boolean ? Math.round(value) : value;
}

/**
 * A modifier's settings by the paths the module writes them at: a vector's components as `name[i]`.
 * @param {Record<string, any>} settings
 * @param {Record<string, any>} layouts
 */
const values = (settings, layouts) => Object.fromEntries(Object.entries(settings).flatMap(([name, value]) => (Array.isArray(value)
  ? value.map((v, i) => [`${name}[${i}]`, setting(layouts, name, v)]) : [[name, setting(layouts, name, value)]])));

/**
 * The polyfill's message handler: its worker, or the worker's module run in this thread where there are no workers
 * (Node), as a script has no page to keep responsive.
 * @param {URL} url
 * @returns {Promise<(message: any) => Promise<any>>}
 */
async function connect(url) {
  if (typeof Worker === 'undefined') return (await import(url.href)).handle;
  const worker = new Worker(url, { type: 'module' });
  /** @type {Map<number, (reply: any) => void>} */
  const replies = new Map();
  let next = 0;
  worker.onmessage = ({ data }) => {
    replies.get(data.id)?.(data);
    replies.delete(data.id);
  };
  return async (message) => {
    if (message.wasm) return worker.postMessage(message);
    return new Promise((resolve) => {
      replies.set(next, resolve);
      worker.postMessage({ ...message, id: next++ });
    });
  };
}

/** @param {import('./scheduler.js').Page} page @returns {Promise<import('./scheduler.js').Evaluator>} */
export async function load({ root }) {
  const handle = await connect(new URL('bylonder-modifiers/modifiers-worker.js', root));
  await handle({ wasm: new URL('bylonder-modifiers/modifiers.wasm', root).href });
  /** @param {any} message */
  const evaluate = async (message) => {
    const reply = await handle(message);
    if (reply.error) throw new Error(reply.error);
    return reply.result;
  };
  /** @type {import('./scheduler.js').Evaluator['runChain']} */
  const runChain = async (run) => {
    const modifiers = run.map(([{ mesh, kernel: { type, layouts }, ...settings }]) => ({ type, layouts, values: values(settings, layouts) }));
    const draw = Object.values(run[run.length - 1][1].outputs).some((output) => output && 'draw' in output);
    return { mesh: await evaluate({ mesh: run[0][0].mesh, modifiers, draw }) };
  };
  return {
    runChain,
    run: (inputs, context, entity) => runChain([[inputs, entity]], context),
    draw: (mesh) => evaluate({ mesh, modifiers: [], draw: true }),
  };
}
