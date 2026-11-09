// Prepare Shaders Ahead: on WebGPU, once the views settle with new shaders, one frame draws every object (culling off)
// and the views settle once the GPU has compiled it; nothing on WebGL 2 or with the preference off.
import assert from 'node:assert/strict';
import { createPipelineWarmup } from '../src/draw/pipeline-warmup.js';

let done;
const engine = { isWebGPU: true, _compiledEffects: { a: 1 }, _device: { queue: { onSubmittedWorkDone: () => new Promise((resolve) => { done = resolve; }) } } };
const scene = { getEngine: () => engine, skipFrustumClipping: false };
let enabled = true;
const settle = createPipelineWarmup(scene, () => enabled);

assert.equal(settle(), true, 'a frame to warm');
assert.equal(scene.skipFrustumClipping, true, 'drawn unculled');
assert.equal(settle(), true, 'busy while the GPU compiles');
assert.equal(scene.skipFrustumClipping, false, 'culling back');
done(); await null;
assert.equal(settle(), false, 'settled once compiled');
assert.equal(settle(), false, 'no new shaders, no frame');
engine._compiledEffects.b = 1;
enabled = false;
assert.equal(settle(), false, 'off by preference');
enabled = true; engine.isWebGPU = false;
assert.equal(settle(), false, 'nothing on WebGL 2');
console.log('Pipeline warm-up: one unculled frame per new set of shaders on WebGPU, settled once compiled');
