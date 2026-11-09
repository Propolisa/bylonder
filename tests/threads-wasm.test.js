import assert from 'node:assert/strict';
import { instantiate } from '../src/port/wasm.js';
import { BMESH_WASM } from '../src/bmesh/bmesh-module.js';

// Blender's code runs on several threads (wasm32-wasi-threads, src/port/wasm-threads.js): its threading::parallel_for
// spreads work over the module's threads, and on one thread (a page without cross-origin isolation) runs it all there.
const threaded = await instantiate(BMESH_WASM, 4);
assert.ok(threaded.exports.threads_parallel_for(64) > 1, 'parallel_for runs on several threads');
const single = await instantiate(BMESH_WASM, 1);
assert.equal(single.exports.threads_parallel_for(64), 1, 'parallel_for runs on the one thread');
console.log('threads ok');
process.exit(0);
