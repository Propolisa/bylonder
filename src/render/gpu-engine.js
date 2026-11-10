// The GPU backend Babylon draws with: WebGL 2 (Engine) or WebGPU (WebGPUEngine). Bylonder's GPU Backend preference
// (workspace/preferences.js) picks it; the engine exists before the Preferences load, so it is read from the mirror the
// preference keeps in the browser's storage. A `gpu` URL parameter on the app overrides it (the browser tests'
// E2E_ENGINE). WebGPU falls back to WebGL 2 where the browser has no adapter.
import { Engine, Tools, WebGPUEngine } from '@babylonjs/core';
import '../overrides/babylon/geometry-gamma-albedo.js';
import { declarationLists } from '../overrides/webgpu/declaration-lists.js';
import { depthMetricVaryings } from '../overrides/webgpu/depth-metric-varyings.js';
import { WEBGPU_OPTIONS } from '../overrides/webgpu/maximum-limits.js';
import { lightBlocksWhereRead } from '../overrides/webgpu/vertex-light-blocks.js';
import { glslInWorker } from '../overrides/webgpu/glsl-in-worker.js';
import { pbrFromGLSL } from '../overrides/webgpu/pbr-from-glsl.js';
import { rejectedPipelines } from '../overrides/webgpu/rejected-pipelines.js';
import { shortEffectNames } from '../overrides/webgpu/short-effect-names.js';

const KEY = 'bylonder-gpu-backend';
// Babylon's assets (its area lights' LTC table), served by the app (scripts/babylon-assets.mjs) instead of Babylon's site.
Tools.AssetBaseUrl = new URL('babylon-assets', document.baseURI).href;
// Babylon's GLSL to WGSL compilers, served by the app (scripts/babylon-assets.mjs).
const compiler = (name) => ({ jsPath: new URL(`webgpu/${name}.js`, document.baseURI).href, wasmPath: new URL(`webgpu/${name}.wasm`, document.baseURI).href });
const workerFiles = (name) => ({ js: compiler(name).jsPath, wasm: compiler(name).wasmPath });

export function requestedBackend() {
  try { return (new URLSearchParams(top.location.search).get('gpu')?.toUpperCase() ?? localStorage.getItem(KEY)) === 'WEBGPU' ? 'WEBGPU' : 'WEBGL2'; } catch { return 'WEBGL2'; }
}
export const rememberBackend = (backend) => { try { localStorage.setItem(KEY, backend); } catch {} };

// An engine on `canvas` with Babylon's engine `options`, on the requested backend. WebGPU asks for every feature and the
// highest limits the adapter offers, with Bylonder's overrides of it (src/overrides/webgpu/).
export async function createEngine(canvas, options = {}, backend = requestedBackend()) {
  if (backend === 'WEBGPU') {
    pbrFromGLSL();
    try {
      const engine = new WebGPUEngine(canvas, { ...options, ...WEBGPU_OPTIONS, glslangOptions: compiler('glslang'), twgslOptions: compiler('twgsl') });
      await engine.initAsync();
      declarationLists(rejectedPipelines(shortEffectNames(depthMetricVaryings(lightBlocksWhereRead(glslInWorker(engine, { glslang: workerFiles('glslang'), twgsl: workerFiles('twgsl') }))))));
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
