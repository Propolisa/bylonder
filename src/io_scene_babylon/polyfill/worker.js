// The modifier kernels polyfill's worker (bundled into modifiers-worker.bundle.js by scripts/modifiers-polyfill.mjs):
// instantiates modifiers.wasm from the URL it is given and evaluates the modifiers posted to it, one at a time. Where there are no workers
// (Node), the page's evaluator imports it and calls `handle` in its own thread.
import { instantiate } from '../../port/wasm.js';
import { createEvaluator } from './evaluate.js';

let evaluator;
// A message's reply: none to the module's URL, a modifier's mesh or draw buffers, or its error.
export async function handle(data) {
  if (data.wasm) {
    evaluator = instantiate(new URL(data.wasm)).then(({ exports }) => createEvaluator(exports));
    return null;
  }
  try {
    return { id: data.id, result: (await evaluator)(data) };
  } catch (error) {
    return { id: data.id, error: error.message };
  }
}

if (typeof WorkerGlobalScope !== 'undefined') {
  onmessage = async ({ data }) => {
    const reply = await handle(data);
    if (reply) postMessage(reply, Object.values(reply.result ?? {}).map((array) => array.buffer));
  };
}
