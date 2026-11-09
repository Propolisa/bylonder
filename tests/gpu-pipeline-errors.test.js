// WebGPU: a pipeline the GPU rejects (FXC failing a shader on D3D12) fails its effect as a compile error, once, so its
// meshes are skipped instead of the invalid pipeline invalidating every frame's command buffer.
import assert from 'node:assert/strict';
import { rejectedPipelines } from '../src/overrides/webgpu/rejected-pipelines.js';

const scopes = [], errors = [];
const device = { pushErrorScope: (filter) => scopes.push(filter), popErrorScope: async () => { scopes.pop(); return errors.shift() ?? null; } };
const cache = { _createRenderPipeline: (effect) => ({ effect }) };
rejectedPipelines({ _cacheRenderPipeline: cache, _device: device });

const effect = (name) => {
  const context = { stages: {} };
  return { name, _isReady: true, _pipelineContext: context, failures: [], _processCompilationErrors(error) { this.failures.push(error.message); }, isReady() { return this._isReady && !!this._pipelineContext.stages; } };
};
const settle = () => new Promise((resolve) => setTimeout(resolve));

const good = effect('good');
assert.equal(cache._createRenderPipeline(good).effect, good, 'the pipeline Babylon made');
assert.deepEqual(scopes, [], 'scopes popped');
await settle();
assert.deepEqual(good.failures, [], 'a valid pipeline reports nothing');
assert.equal(good.isReady(), true);

const bad = effect('bad');
errors.push(null, { message: 'FXC compile failed with error: E_FAIL' });
cache._createRenderPipeline(bad);
errors.push(null, { message: '[Invalid RenderPipeline] is invalid' });
cache._createRenderPipeline(bad);
await settle();
assert.deepEqual(bad.failures, ['FXC compile failed with error: E_FAIL'], 'reported once, as a compile error');
assert.equal(bad.isReady(), false, 'its meshes are skipped');
console.log('WebGPU pipeline errors: a pipeline the GPU rejects fails its effect once instead of the frame');
