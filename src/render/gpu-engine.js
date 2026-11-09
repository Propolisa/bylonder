// The GPU backend Babylon draws with: WebGL 2 (Engine) or WebGPU (WebGPUEngine). Bylonder's GPU Backend preference
// (workspace/preferences.js) picks it; the engine exists before the Preferences load, so it is read from the mirror the
// preference keeps in the browser's storage. A `gpu` URL parameter on the app overrides it (the browser tests'
// E2E_ENGINE). WebGPU falls back to WebGL 2 where the browser has no adapter.
import { Engine, PBRBaseMaterial, WebGPUEngine } from '@babylonjs/core';
import { WebGPUPipelineContext } from '@babylonjs/core/Engines/WebGPU/webgpuPipelineContext.js';
import { deriveDepthMetrics } from './depth-metric-varyings.js';
import { stageSource } from './glsl-to-wgsl.js';

const KEY = 'bylonder-gpu-backend';
// Babylon's GLSL to WGSL compilers, served by the app (scripts/webgpu-compilers.mjs).
const compiler = (name) => ({ jsPath: new URL(`webgpu/${name}.js`, document.baseURI).href, wasmPath: new URL(`webgpu/${name}.wasm`, document.baseURI).href });

// Babylon's WebGPU engine compiles an effect's GLSL in a promise whose failure reaches no effect, so a shader that does
// not compile leaves its effect waiting for ever. It fails here as on WebGL 2, through the effect's own error path.
// A pipeline the GPU rejects (FXC, a shader compiler of Dawn's D3D12 backend, fails some WGSL) fails its effect the same
// way, so its meshes are skipped and reported once instead of invalidating every frame's command buffer.
export class ReportingWebGPUEngine extends WebGPUEngine {
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

  // GLSL converts to WGSL in a worker (glsl-to-wgsl.js, wgsl-worker.js), off the page's thread. The browser makes a
  // shader module from its WGSL on the page's thread: stages with the same WGSL share one module.
  async _preparePipelineContextAsync(context, vertex, fragment, raw, rawVertex, rawFragment, rebind, defines, ...rest) {
    try {
      if (context.shaderProcessingContext.shaderLanguage !== 0) return await super._preparePipelineContextAsync(context, vertex, fragment, raw, rawVertex, rawFragment, rebind, defines, ...rest);
      context.sources = { vertex, fragment, rawVertex, rawFragment };
      const stage = async (code, kind) => ({ module: this._shaderModule(await convert(stageSource(code, defines, raw), kind), kind), entryPoint: 'main' });
      const [vertexStage, fragmentStage] = await Promise.all([stage(vertex, 'vertex'), stage(fragment, 'fragment')]);
      context.stages = { vertexStage, fragmentStage };
      rest.at(-1)();
    } catch (error) { Object.values(this._compiledEffects).find((effect) => effect._pipelineContext === context)?._processCompilationErrors(error); }
  }

  createPipelineContext(context) { return new ShortNamedPipelineContext(context, this); }

  _shaderModule(code, label) {
    this._modules ??= new Map();
    if (!this._modules.has(code)) this._modules.set(code, this._device.createShaderModule({ label, code }));
    return this._modules.get(code);
  }
}

// An effect's pipeline context names its uniform buffer after the effect's key, which for a material built from source
// (a node material) is its whole GLSL: the GPU buffer's label, copied at every creation. It takes a hash of it instead.
class ShortNamedPipelineContext extends WebGPUPipelineContext {
  get _name() { return this.shortName; }
  set _name(name) { this.shortName = name.length > 64 ? `effect-${fnv1a(name)}` : name; }
}
const fnv1a = (text) => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
  return (hash >>> 0).toString(16).padStart(8, '0');
};

let worker = null, next = 0;
const pending = new Map();
// A GLSL stage's WGSL, from the worker.
function convert(source, stage) {
  if (!worker) {
    worker = new Worker(new URL('./wgsl-worker.js', import.meta.url), { type: 'module' });
    const files = (name) => ({ js: compiler(name).jsPath, wasm: compiler(name).wasmPath });
    worker.postMessage({ init: { glslang: files('glslang'), twgsl: files('twgsl') } });
    worker.onmessage = ({ data: { id, wgsl, error } }) => {
      const { resolve, reject } = pending.get(id);
      pending.delete(id);
      if (error === undefined) resolve(wgsl); else reject(Error(error));
    };
  }
  const id = next++;
  return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); worker.postMessage({ id, source, stage }); });
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

// PBR materials compile from Babylon's GLSL on WebGPU, converted as Bylonder's own shaders are, so the GLSL plugins on
// them (curves, point clouds, Dithered) draw there too; Bylonder's Standard materials ask for it (forceGLSL).
export function materialsFromGLSL() { PBRBaseMaterial.ForceGLSL = true; }

export function requestedBackend() {
  try { return (new URLSearchParams(top.location.search).get('gpu')?.toUpperCase() ?? localStorage.getItem(KEY)) === 'WEBGPU' ? 'WEBGPU' : 'WEBGL2'; } catch { return 'WEBGL2'; }
}
export const rememberBackend = (backend) => { try { localStorage.setItem(KEY, backend); } catch {} };

// An engine on `canvas` with Babylon's engine `options`, on the requested backend. WebGPU asks for every feature and the
// highest limits the adapter offers.
export async function createEngine(canvas, options = {}, backend = requestedBackend()) {
  if (backend === 'WEBGPU') {
    materialsFromGLSL();
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
