// The GPU backend Babylon draws with: WebGL 2 (Engine) or WebGPU (WebGPUEngine). Bylonder's GPU Backend preference
// (workspace/preferences.js) picks it; the engine exists before the Preferences load, so it is read from the mirror the
// preference keeps in the browser's storage. A `gpu` URL parameter on the app overrides it (the browser tests'
// E2E_ENGINE). WebGPU falls back to WebGL 2 where the browser has no adapter.
import { Engine, WebGPUEngine } from '@babylonjs/core';
import { deriveDepthMetrics } from './depth-metric-varyings.js';

const KEY = 'bylonder-gpu-backend';
// Babylon's GLSL to WGSL compilers, served by the app (scripts/webgpu-compilers.mjs).
const compiler = (name) => ({ jsPath: new URL(`webgpu/${name}.js`, document.baseURI).href, wasmPath: new URL(`webgpu/${name}.wasm`, document.baseURI).href });

// Babylon's WebGPU engine compiles an effect's GLSL in a promise whose failure reaches no effect, so a shader that does
// not compile leaves its effect waiting for ever. It fails here as on WebGL 2, through the effect's own error path.
// A pipeline the GPU rejects (FXC, a shader compiler of Dawn's D3D12 backend, fails some WGSL) fails its effect the same
// way, so its meshes are skipped and reported once instead of invalidating every frame's command buffer.
class ReportingWebGPUEngine extends WebGPUEngine {
  async initAsync(...args) {
    await super.initAsync(...args);
    failRejectedPipelines(this._cacheRenderPipeline, this._device);
  }

  // GLSL effects derive their shadows' depth metrics in the fragment stage, within WebGPU's inter-stage limit.
  createEffect(baseName, options, ...args) {
    if (options?.attributes !== undefined && !options.shaderLanguage) {
      const after = options.processCodeAfterIncludes;
      options = { ...options, processCodeAfterIncludes: (type, code, defines) => deriveDepthMetrics(type, after ? after(type, code, defines) : code) };
    }
    return super.createEffect(baseName, options, ...args);
  }

  async _preparePipelineContextAsync(context, ...args) {
    try { return await super._preparePipelineContextAsync(context, ...args); }
    catch (error) { Object.values(this._compiledEffects).find((effect) => effect._pipelineContext === context)?._processCompilationErrors(error); }
  }
}

// Babylon's pipeline cache creates its pipelines in one method, with no hook; this instance's is wrapped in error scopes.
export function failRejectedPipelines(cache, device) {
  const create = cache._createRenderPipeline.bind(cache);
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
}

export function requestedBackend() {
  try { return (new URLSearchParams(top.location.search).get('gpu')?.toUpperCase() ?? localStorage.getItem(KEY)) === 'WEBGPU' ? 'WEBGPU' : 'WEBGL2'; } catch { return 'WEBGL2'; }
}
export const rememberBackend = (backend) => { try { localStorage.setItem(KEY, backend); } catch {} };

// An engine on `canvas` with Babylon's engine `options`, on the requested backend. WebGPU asks for every feature and the
// highest limits the adapter offers.
export async function createEngine(canvas, options = {}, backend = requestedBackend()) {
  if (backend === 'WEBGPU') {
    try {
      const engine = new ReportingWebGPUEngine(canvas, { ...options, enableAllFeatures: true, setMaximumLimits: true, glslangOptions: compiler('glslang'), twgslOptions: compiler('twgsl') });
      await engine.initAsync();
      const { features, limits } = engine._device, granted = {};
      for (const name in limits) granted[name] = limits[name];
      console.info(`WebGPU device: ${JSON.stringify({ features: [...features], limits: granted })}`);
      return engine;
    } catch (error) {
      console.warn(`WebGPU unavailable, drawing with WebGL 2: ${error.message ?? error}`);
    }
  }
  return new Engine(canvas, true, options);
}
