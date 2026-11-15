// A worker of a module's thread pool (wasm-threads.js startThreads): instantiates the module, then runs each thread its
// slot is given.
import { threadImports, missing } from './wasm.js';
import { syncSideModules } from './side-modules.js';
import { STARTED, IDLE, threadSpawn } from './wasm-threads.js';

const isNode = !!globalThis.process?.versions?.node;

async function thread({ module, memory, control, count, slot }, post) {
  const slots = new Int32Array(control);
  let instance;
  const sync = () => syncSideModules(instance.exports, missing);
  try {
    instance = await WebAssembly.instantiate(module, threadImports(memory, count, threadSpawn(control), { side_modules_sync: sync }));
  } catch (error) {
    return post({ starting: true, error: error.message });
  }
  post({});
  for (;;) {
    // Waking now and then to load the side modules the page loaded (side-modules.js), as wasm/threads.cc's waits do.
    for (let state; (state = Atomics.load(slots, slot)) !== STARTED;) {
      Atomics.wait(slots, slot, state, 200);
      sync();
    }
    sync();
    try {
      instance.exports.wasi_thread_start(slots[slot + 1], slots[slot + 2]);
    } catch (error) {
      post({ error: error.stack ?? error.message });
    }
    Atomics.store(slots, slot, IDLE);
  }
}

if (isNode) {
  const { parentPort } = process.getBuiltinModule('worker_threads');
  parentPort.once('message', (data) => thread(data, (message) => parentPort.postMessage(message)));
} else {
  addEventListener('message', ({ data }) => thread(data, postMessage), { once: true });
}
