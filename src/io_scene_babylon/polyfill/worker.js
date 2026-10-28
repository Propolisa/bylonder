// The modifier kernels polyfill's worker (bundled into modifiers-worker.bundle.js by scripts/modifiers-polyfill.mjs):
// instantiates modifiers.wasm from the URL it is given and evaluates stacks posted to it.
import { instantiate } from '../../port/wasm.js';
import { createEvaluator } from './evaluate.js';

let evaluator;
onmessage = async ({ data }) => {
  if (data.wasm) {
    evaluator = instantiate(new URL(data.wasm)).then(({ exports }) => createEvaluator(exports));
    return;
  }
  try {
    const buffers = (await evaluator)(data.base, data.stack);
    postMessage({ id: data.id, buffers }, Object.values(buffers).map((array) => array.buffer));
  } catch (error) {
    postMessage({ id: data.id, error: error.message });
  }
};
