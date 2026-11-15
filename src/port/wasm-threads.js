// Threads of a module built for wasm32-wasi-threads (tools/blender-port/blender_build.py): each is a worker holding an
// instance of the module on its shared memory, started ahead (a worker cannot start while the page's thread waits on
// it), which runs the module's wasi_thread_start when wasi's thread-spawn hands it a thread. The pool's state is a
// SharedArrayBuffer of slots (state, thread id, start argument), so any thread can spawn without the page's event loop.
export const IDLE = 0, STARTED = 2;
const CLAIMED = 1, SLOT = 3;
const isNode = !!globalThis.process?.versions?.node;

// Where shared memory can be made and handed to workers: cross-origin isolated pages, and Node.
export const threadsAvailable = () => isNode || !!globalThis.crossOriginIsolated;
// Bylonder's Threads preference (workspace/preferences.js), mirrored in the browser's storage as the module starts
// before the Preferences load: AUTO uses the page's processors, OFF one thread.
const THREADS_KEY = 'bylonder-threads';
const threadsPreference = () => { try { return localStorage.getItem(THREADS_KEY) ?? 'AUTO'; } catch { return 'AUTO'; } };
export const rememberThreads = (value) => { try { localStorage.setItem(THREADS_KEY, value); } catch {} };
// The threads a module runs on: the page's processors but one, which the page keeps for itself, unless the preference
// is OFF; in Node, BYLONDER_THREADS (one when unset, so tests and build tools start no workers).
const browserThreads = () => { const cores = navigator.hardwareConcurrency || 1; return cores > 2 ? cores - 1 : cores; };
export const hardwareThreads = () => (isNode ? Number(process.env.BYLONDER_THREADS ?? 1)
  : threadsPreference() === 'OFF' ? 1 : browserThreads()) || 1;

// wasi's thread-spawn over a pool's slots: an idle slot takes the thread; a negative errno (EAGAIN) when none is idle.
export const threadSpawn = (control) => {
  const slots = new Int32Array(control);
  return (arg) => {
    for (let at = 1; at < slots.length; at += SLOT) {
      if (Atomics.compareExchange(slots, at, IDLE, CLAIMED) !== IDLE) continue;
      slots[at + 1] = Atomics.add(slots, 0, 1) + 1;
      slots[at + 2] = arg;
      Atomics.store(slots, at, STARTED);
      Atomics.notify(slots, at);
      return slots[at + 1];
    }
    return -6;
  };
};

// A pool of `count` threads for a compiled module on its shared memory, once every worker has instantiated it; rejected,
// its workers stopped, when one fails to load or start or is not ready within `wait` ms. `worker`: Node's worker file.
// `files`: the threads' file calls (thread-files.js), which `serve` makes when a worker says one waits.
export async function startThreads(module, memory, count, { wait = 30000, worker: file = new URL('./wasm-thread.js', import.meta.url), files, serve } = {}) {
  const control = new SharedArrayBuffer(4 * (1 + SLOT * count));
  const workers = [];
  const started = Promise.all(Array.from({ length: count }, (_, i) => new Promise((resolve, reject) => {
    // Written out, so the build bundles the worker with what it imports.
    const worker = isNode ? new (process.getBuiltinModule('worker_threads').Worker)(file) : new Worker(new URL('./wasm-thread.js', import.meta.url), { type: 'module' });
    workers.push(worker);
    const listen = (type, handler) => (isNode ? worker.on(type, handler) : worker.addEventListener(type, (event) => handler(type === 'message' ? event.data : event)));
    // A Node process ends without waiting for its threads.
    const ready = () => (isNode && worker.unref(), resolve());
    listen('message', (data) => (data.files ? serve() : !data.error ? ready() : data.starting ? reject(Error(`thread ${i}: ${data.error}`)) : console.error(`thread ${i}: ${data.error}`)));
    listen('error', (error) => reject(Error(`thread ${i}: ${error.message || 'its worker did not load'}`)));
    worker.postMessage({ module, memory, control, count, slot: 1 + i * SLOT, files, index: i });
  })));
  let timer;
  const late = new Promise((_, reject) => { timer = setTimeout(() => reject(Error(`threads not ready within ${wait / 1000} s`)), wait); });
  try {
    await Promise.race([started, late]);
  } catch (error) {
    workers.forEach((worker) => worker.terminate());
    throw error;
  } finally {
    clearTimeout(timer);
  }
  return threadSpawn(control);
}
