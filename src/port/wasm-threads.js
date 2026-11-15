// Threads of a module built for wasm32-wasi-threads (tools/blender-port/blender_build.py): each is a worker holding an
// instance of the module on its shared memory, started ahead (a worker cannot start while the page's thread waits on
// it), which runs the module's wasi_thread_start when wasi's thread-spawn hands it a thread. The pool's state is a
// SharedArrayBuffer of slots (state, thread id, start argument), so any thread can spawn without the page's event loop.
const IDLE = 0, CLAIMED = 1, STARTED = 2, SLOT = 3;
const isNode = !!globalThis.process?.versions?.node;

// Where shared memory can be made and handed to workers: cross-origin isolated pages, and Node.
export const threadsAvailable = () => isNode || !!globalThis.crossOriginIsolated;
// Bylonder's Threads preference (workspace/preferences.js), mirrored in the browser's storage as the module starts
// before the Preferences load: AUTO uses the page's processors, OFF one thread.
const THREADS_KEY = 'bylonder-threads';
const threadsPreference = () => { try { return localStorage.getItem(THREADS_KEY) ?? 'AUTO'; } catch { return 'AUTO'; } };
export const rememberThreads = (value) => { try { localStorage.setItem(THREADS_KEY, value); } catch {} };
// The threads a module runs on: the page's processors unless the preference is OFF; in Node, BYLONDER_THREADS (one when
// unset, so tests and build tools start no workers).
export const hardwareThreads = () => (isNode ? Number(process.env.BYLONDER_THREADS ?? 1)
  : threadsPreference() === 'OFF' ? 1 : navigator.hardwareConcurrency) || 1;

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

// A pool of `count` threads for a compiled module on its shared memory, once every worker has instantiated it.
export async function startThreads(module, memory, count) {
  const control = new SharedArrayBuffer(4 * (1 + SLOT * count));
  const url = new URL('./wasm-threads.js', import.meta.url);
  await Promise.all(Array.from({ length: count }, (_, i) => new Promise((resolve, reject) => {
    const worker = isNode ? new (process.getBuiltinModule('worker_threads').Worker)(url) : new Worker(url, { type: 'module' });
    const listen = (handler) => (isNode ? worker.on('message', handler) : worker.addEventListener('message', ({ data }) => handler(data)));
    // A Node process ends without waiting for its threads.
    const ready = () => (isNode && worker.unref(), resolve());
    listen((data) => (!data.error ? ready() : data.starting ? reject(Error(`thread ${i}: ${data.error}`)) : console.error(`thread ${i}: ${data.error}`)));
    worker.postMessage({ module, memory, control, count, slot: 1 + i * SLOT });
  })));
  return threadSpawn(control);
}

// A worker of the pool: instantiates the module, then runs each thread its slot is given.
async function thread({ module, memory, control, count, slot }, post) {
  const { threadImports } = await import('./wasm.js');
  const slots = new Int32Array(control);
  let instance;
  try {
    instance = await WebAssembly.instantiate(module, threadImports(memory, count, threadSpawn(control)));
  } catch (error) {
    return post({ starting: true, error: error.message });
  }
  post({});
  for (;;) {
    for (let state; (state = Atomics.load(slots, slot)) !== STARTED;) Atomics.wait(slots, slot, state);
    try {
      instance.exports.wasi_thread_start(slots[slot + 1], slots[slot + 2]);
    } catch (error) {
      post({ error: error.stack ?? error.message });
    }
    Atomics.store(slots, slot, IDLE);
  }
}

if (isNode) {
  const { isMainThread, parentPort } = process.getBuiltinModule('worker_threads');
  if (!isMainThread) parentPort.on('message', (data) => data?.control && thread(data, (message) => parentPort.postMessage(message)));
} else if (globalThis.WorkerGlobalScope && globalThis instanceof WorkerGlobalScope) {
  addEventListener('message', ({ data }) => data.control && thread(data, postMessage), { once: true });
}
