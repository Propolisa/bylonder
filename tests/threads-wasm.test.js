import assert from 'node:assert/strict';
import { instantiate } from '../src/port/wasm.js';
import { BMESH_WASM } from '../src/bmesh/bmesh-module.js';

// Blender's code runs on several threads (wasm32-wasi-threads, src/port/wasm-threads.js): its threading::parallel_for
// spreads work over the module's threads, and on one thread (a page without cross-origin isolation) runs it all there.
const threaded = await instantiate(BMESH_WASM, 4);
assert.ok(threaded.exports.threads_parallel_for(64) > 1, 'parallel_for runs on several threads');
const single = await instantiate(BMESH_WASM, 1);
assert.equal(single.exports.threads_parallel_for(64), 1, 'parallel_for runs on the one thread');

// Workers that fail to load, or never say they are ready, leave the module on the page's thread with the reason, never
// waiting on them.
const worker = (code) => new URL(`data:text/javascript,${encodeURIComponent(code)}`);
for (const [what, file] of [['fails to load', worker('throw Error("no module")')], ['never ready', worker('setInterval(() => {}, 1000)')]]) {
  const fallback = await instantiate(BMESH_WASM, 4, { worker: file, wait: 2000 });
  assert.equal(fallback.threads, 1, `a worker that ${what}: one thread`);
  assert.match(fallback.threadsError ?? '', /^Blender runs on one thread: /, `a worker that ${what}: the reason`);
  assert.equal(fallback.exports.threads_parallel_for(64), 1, `a worker that ${what}: parallel_for runs on the one thread`);
}
// A thread's thread_local objects are destroyed when it ends, as Blender's per-thread memory counters unregister then:
// left registered, they were written to after the thread's memory was freed (Cycles' bakes trapping in malloc).
assert.ok(threaded.exports.threads_local_destructed(), "a thread's thread_local destructors run when it ends");
// A thread that stops on a trap while the page waits for it: the page's call throws what stopped it instead of waiting
// forever.
assert.throws(() => threaded.exports.threads_trap(), /^Error: A thread of Blender's stopped: RuntimeError: unreachable/, 'a trapped thread is reported');
console.log('threads ok; thread_local destructors run at thread end; a failing thread worker leaves Blender on one thread; a thread that traps is reported, not waited on');
process.exit(0);
