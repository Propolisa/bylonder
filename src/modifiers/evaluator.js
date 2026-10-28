// Where evaluations of Blender's modifiers (blender.js `evaluation`) run: here, or in workers, each with its own
// instance of the module compiled once here. Stopping a worker's evaluation terminates the worker, the only way to stop
// WebAssembly, and the next evaluation gets a fresh one. Both give the evaluated Mesh.
import { compile } from '../port/wasm.js';
import { BMESH_WASM } from '../bmesh/bmesh-module.js';
import { attachedMesh } from '../bmesh/bmesh-wasm.js';
import { evaluate, ModifierError } from './blender.js';

export const evaluateHere = (evaluation) => attachedMesh(evaluate(evaluation));

// A worker that failed (a trap, or out of memory) or stopped, whose module may not be usable again.
export class EvaluationFailed extends Error {
  name = 'EvaluationFailed';
}

const IDLE = 2;

export function createWorkerEvaluator() {
  const spawn = async () => {
    const worker = new Worker(new URL('./modifier-worker.js', import.meta.url), { type: 'module' });
    worker.postMessage({ module: await compile(BMESH_WASM) });
    return worker;
  };
  // Started ahead, so the first evaluation does not wait for a worker to load.
  const idle = [spawn()];
  return async (evaluation, signal) => {
    const worker = await (idle.pop() ?? spawn());
    return new Promise((resolve, reject) => {
      const end = (keep) => {
        signal?.removeEventListener('abort', stopped);
        if (keep && idle.length < IDLE) idle.push(Promise.resolve(worker));
        else {
          worker.terminate();
          if (!idle.length) idle.push(spawn());
        }
      };
      const stopped = () => { end(false); reject(signal.reason); };
      if (signal?.aborted) return stopped();
      signal?.addEventListener('abort', stopped, { once: true });
      worker.onmessage = ({ data }) => {
        end(!data.error || data.name === 'ModifierError');
        if (!data.error) resolve(attachedMesh(data.result));
        else reject(data.name === 'ModifierError' ? new ModifierError(data.error) : new EvaluationFailed(data.error));
      };
      worker.onerror = (event) => { end(false); reject(new EvaluationFailed(event.message || 'Modifier evaluation failed')); };
      worker.postMessage({ evaluation });
    });
  };
}
