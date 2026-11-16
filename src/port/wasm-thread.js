// A worker of a module's thread pool (wasm-threads.js startThreads): instantiates the module, then runs each thread its
// slot is given.
import { threadImports, missing } from './wasm.js';
import { syncSideModules } from './side-modules.js';
import { STARTED, IDLE, threadSpawn } from './wasm-threads.js';

const isNode = !!globalThis.process?.versions?.node;

async function thread({ module, memory, control, count, slot, files, index }, post) {
  const slots = new Int32Array(control);
  let instance;
  const sync = () => syncSideModules(instance.exports, missing);
  try {
    const own = { side_modules_sync: sync }, filesSlot = { buffer: files, slot: index, notify: () => post({ files: true }) };
    instance = await WebAssembly.instantiate(module, threadImports(memory, count, threadSpawn(control), own, filesSlot));
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
      died(instance.exports, memory, error.stack ?? error.message);
      post({ error: error.stack ?? error.message });
    }
    Atomics.store(slots, slot, IDLE);
  }
}

// A thread that stopped on a trap: what stopped it, and the word the page's waits look at (wasm/threads.cc), so the
// page stops waiting for it and reports it.
function died(exports, memory, message) {
  const at = exports.threads_died_word?.() >>> 0;
  if (!at) return;
  const text = new TextEncoder().encode(message).subarray(0, 1019);
  new Uint8Array(memory.buffer, (at + 4) >>> 0, text.length + 1).set([...text, 0]);
  Atomics.store(new Int32Array(memory.buffer, at >>> 0, 1), 0, 1);
}

if (isNode) {
  const { parentPort } = process.getBuiltinModule('worker_threads');
  parentPort.once('message', (data) => thread(data, (message) => parentPort.postMessage(message)));
} else {
  addEventListener('message', ({ data }) => thread(data, postMessage), { once: true });
}
