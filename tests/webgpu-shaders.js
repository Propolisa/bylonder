// Shaders as Babylon's WebGPU engine compiles them, without a GPU: an engine that processes an effect's GLSL with
// Babylon's WebGPU shader processor and compiles it with the glslang and Tint (twgsl) builds the app serves
// (public/webgpu, scripts/webgpu-compilers.mjs) through the app's own conversion (src/render/glsl-to-wgsl.js, which its
// worker runs), recording each effect's WGSL or why it has none.
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';
import { NullEngine } from '@babylonjs/core';
import { WebGPUShaderProcessorGLSL } from '@babylonjs/core/Engines/WebGPU/webgpuShaderProcessorsGLSL.js';
import { WebGPUShaderProcessorWGSL } from '@babylonjs/core/Engines/WebGPU/webgpuShaderProcessorsWGSL.js';
import { WebGPUShaderProcessingContext } from '@babylonjs/core/Engines/WebGPU/webgpuShaderProcessingContext.js';
import { WebGPUPipelineContext } from '@babylonjs/core/Engines/WebGPU/webgpuPipelineContext.js';
import { ShaderCodeInliner } from '@babylonjs/core/Engines/Processors/shaderCodeInliner.js';
import { glslToWGSL, stageSource } from '../src/render/glsl-to-wgsl.js';

const dir = new URL('../public/webgpu/', import.meta.url);
export const compilersPresent = () => existsSync(new URL('glslang.wasm', dir)) && existsSync(new URL('twgsl.wasm', dir));

// An Emscripten build of the browser's, run in a context of its own.
function boot(name) {
  const context = { console, WebAssembly, performance, TextDecoder, TextEncoder, setTimeout, clearTimeout, URL, Uint8ClampedArray,
    self: { location: { href: 'http://localhost/' } }, document: { currentScript: { src: 'http://localhost/' } } };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(`${readFileSync(new URL(`${name}.js`, dir), 'utf8')}\n;this.factory = Module;`, context);
  const bytes = readFileSync(new URL(`${name}.wasm`, dir));
  return new Promise((resolve) => {
    const module = {
      instantiateWasm(imports, done) { WebAssembly.instantiate(bytes, imports).then((result) => done(result.instance)); return {}; },
      onRuntimeInitialized: () => resolve({ module }), print() {}, printErr: (line) => { module.log.push(line); }, log: [],
    };
    context.factory(module);
  });
}

// The compilers as the app's worker uses them (glsl-to-wgsl.js): glslang.compileGLSL throws with glslang's log.
export async function createCompilers() {
  const glslang = (await boot('glslang')).module, twgsl = (await boot('twgsl')).module;
  let wgsl = '';
  twgsl._return_string_callback = (data, length) => { wgsl = new TextDecoder().decode(twgsl.HEAPU8.subarray(data, data + length)); };
  return {
    glslang: {
      compileGLSL(source, stage, debug) {
        glslang.log.length = 0;
        try { return glslang.compileGLSL(source, stage, debug); } catch { throw Error(glslang.log.join(String.fromCharCode(10))); }
      },
    },
    twgsl: {
      convertSpirV2WGSL(spirv) {
        const at = twgsl._malloc(spirv.byteLength);
        twgsl.HEAPU32.set(spirv, at / 4);
        wgsl = '';
        twgsl._spirv_to_wgsl(at, spirv.byteLength);
        twgsl._free(at);
        return wgsl;
      },
    },
  };
}

// What WGSL in Babylon's Tint build writes that WebGPU then rejects.
export const WGSL_REJECTS = [
  [/@stride\(/, 'an explicitly strided array (Tint writes it for a shader that uses isnan or isinf)'],
  [/bitcast<f32>\(2143289344u\)|bitcast<f32>\(4290772992u\)/, 'a NaN constant'],
];

// A NullEngine that processes and compiles effects as Babylon's WebGPU engine does; `results` holds each effect's.
export class WebGPUShaderEngine extends NullEngine {
  constructor(compilers) {
    super();
    Object.assign(this, { _isWebGPU: true, _shaderPlatformName: 'WEBGPU', compilers, results: [] });
    this._features.needShaderCodeInlining = true;
    this._glslProcessor = new WebGPUShaderProcessorGLSL();
    this._wgslProcessor = new WebGPUShaderProcessorWGSL();
  }
  // Uniform buffers, as WebGPU always has them, that hold nothing.
  get supportsUniformBuffers() { return true; }
  createUniformBuffer(elements) { return { capacity: elements.byteLength ?? elements.length * 4, references: 1 }; }
  createDynamicUniformBuffer(elements) { return this.createUniformBuffer(elements); }
  updateUniformBuffer() {}
  bindUniformBufferBase() {}
  bindUniformBlock() {}
  _releaseBuffer() { return true; }
  _getShaderProcessor(shaderLanguage) { return shaderLanguage === 1 ? this._wgslProcessor : this._glslProcessor; }
  _getShaderProcessingContext(shaderLanguage, pureMode) { return new WebGPUShaderProcessingContext(shaderLanguage, pureMode); }
  inlineShaderCode(code) {
    const inliner = new ShaderCodeInliner(code);
    inliner.processCode();
    return inliner.code;
  }
  createPipelineContext(context) { return new WebGPUPipelineContext(context, this); }
  async _preparePipelineContextAsync(context, vertex, fragment, raw, _rawVertex, _rawFragment, _rebind, defines, _feedback, key, onReady) {
    const result = { key, errors: [], wgsl: {} };
    if (context.shaderProcessingContext.shaderLanguage === 0) {
      for (const [stage, code] of [['vertex', vertex], ['fragment', fragment]]) {
        try {
          const wgsl = glslToWGSL(this.compilers, stageSource(code, defines, raw), stage);
          result.wgsl[stage] = wgsl;
          for (const [pattern, why] of WGSL_REJECTS) if (pattern.test(wgsl)) result.errors.push(`${stage}: ${why}`);
        } catch (error) { result.errors.push(`${stage}: ${error.message.split('\n').filter((line) => /ERROR/.test(line)).slice(0, 3).join(' ')}`); }
      }
    }
    this.results.push(result);
    context.stages = {};
    onReady();
  }
  _releaseEffect() {}
}
