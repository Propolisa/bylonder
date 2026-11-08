// The GPU backend Babylon draws with: WebGL 2 (Engine) or WebGPU (WebGPUEngine). Bylonder's GPU Backend preference
// (workspace/preferences.js) picks it; the engine exists before the Preferences load, so it is read from the mirror the
// preference keeps in the browser's storage. A `gpu` URL parameter on the app overrides it (the browser tests'
// E2E_ENGINE). WebGPU falls back to WebGL 2 where the browser has no adapter.
import { Engine, GreasedLinePluginMaterial, PBRBaseMaterial, ShadowGenerator, StandardMaterial, WebGPUEngine } from '@babylonjs/core';

const KEY = 'bylonder-gpu-backend';
// Babylon's GLSL to WGSL compilers, served by the app (scripts/webgpu-compilers.mjs).
const compiler = (name) => ({ jsPath: new URL(`webgpu/${name}.js`, document.baseURI).href, wasmPath: new URL(`webgpu/${name}.wasm`, document.baseURI).href });

export function requestedBackend() {
  try { return (new URLSearchParams(top.location.search).get('gpu')?.toUpperCase() ?? localStorage.getItem(KEY)) === 'WEBGPU' ? 'WEBGPU' : 'WEBGL2'; } catch { return 'WEBGL2'; }
}
export const rememberBackend = (backend) => { try { localStorage.setItem(KEY, backend); } catch {} };

// Bylonder's GLSL is the one source for both backends: the materials it extends with GLSL plugins and include edits draw
// from Babylon's GLSL on WebGPU too, which Babylon converts to WGSL.
const GLSL_ON_WEBGPU = [PBRBaseMaterial, StandardMaterial, ShadowGenerator, GreasedLinePluginMaterial];

// An engine on `canvas` with Babylon's engine `options`, on the requested backend. WebGPU asks for every feature and the
// highest limits the adapter offers.
export async function createEngine(canvas, options = {}, backend = requestedBackend()) {
  if (backend === 'WEBGPU') {
    try {
      const engine = new WebGPUEngine(canvas, { ...options, enableAllFeatures: true, setMaximumLimits: true, glslangOptions: compiler('glslang'), twgslOptions: compiler('twgsl') });
      await engine.initAsync();
      for (const type of GLSL_ON_WEBGPU) type.ForceGLSL = true;
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
