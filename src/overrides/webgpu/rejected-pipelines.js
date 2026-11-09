// SPDX-License-Identifier: MIT OR Apache-2.0
// Override of Babylon's WebGPU pipeline cache: a pipeline the GPU rejects (FXC, a shader compiler of Dawn's D3D12 backend, fails some WGSL) fails its effect as a compile error, so its meshes are skipped and reported once instead of the invalid pipeline invalidating every frame's command buffer; goes when Babylon creates pipelines in error scopes itself.

// The engine, its pipeline cache's pipelines made in error scopes (the cache creates them in one method, with no hook).
export function rejectedPipelines(engine) {
  const cache = engine._cacheRenderPipeline, device = engine._device, create = cache._createRenderPipeline.bind(cache);
  cache._createRenderPipeline = (effect, ...args) => {
    const context = effect._pipelineContext;
    device.pushErrorScope('validation');
    device.pushErrorScope('internal');
    const pipeline = create(effect, ...args);
    Promise.all([device.popErrorScope(), device.popErrorScope()]).then((errors) => {
      const error = errors.find(Boolean);
      if (!error || effect._pipelineContext !== context || !context.stages) return;
      effect._processCompilationErrors(error);
      if (effect._pipelineContext === context) { context.stages = null; effect._isReady = false; }
    });
    return pipeline;
  };
  return engine;
}
