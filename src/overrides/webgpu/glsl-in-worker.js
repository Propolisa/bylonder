// SPDX-License-Identifier: MIT OR Apache-2.0
// Override of Babylon's WebGPU engine (_preparePipelineContextAsync): GLSL converts to WGSL in a worker (render/glsl-to-wgsl.js, render/wgsl-worker.js), off the page's thread, stages with the same WGSL share one shader module, and an effect whose GLSL does not compile fails through its own error path, as on WebGL 2, where Babylon's failure reaches no effect and leaves it waiting for ever; goes when Babylon converts off the page's thread and reports to the effect.
import { stageSource } from '../../render/glsl-to-wgsl.js';

// compilers: the glslang and twgsl builds' { js, wasm } URLs.
export function glslInWorker(engine, compilers) {
  const prepare = engine._preparePipelineContextAsync.bind(engine), modules = new Map();
  const shaderModule = (code, label) => {
    if (!modules.has(code)) modules.set(code, engine._device.createShaderModule({ label, code }));
    return modules.get(code);
  };
  engine._preparePipelineContextAsync = async (context, vertex, fragment, raw, rawVertex, rawFragment, rebind, defines, ...rest) => {
    try {
      if (context.shaderProcessingContext.shaderLanguage !== 0) return await prepare(context, vertex, fragment, raw, rawVertex, rawFragment, rebind, defines, ...rest);
      context.sources = { vertex, fragment, rawVertex, rawFragment };
      const stage = async (code, kind) => ({ module: shaderModule(await convert(compilers, stageSource(code, defines, raw), kind), kind), entryPoint: 'main' });
      const [vertexStage, fragmentStage] = await Promise.all([stage(vertex, 'vertex'), stage(fragment, 'fragment')]);
      context.stages = { vertexStage, fragmentStage };
      rest.at(-1)();
    } catch (error) { Object.values(engine._compiledEffects).find((effect) => effect._pipelineContext === context)?._processCompilationErrors(error); }
  };
  return engine;
}

let worker = null, next = 0;
const pending = new Map();
// A GLSL stage's WGSL, from the worker.
function convert(compilers, source, stage) {
  if (!worker) {
    worker = new Worker(new URL('../../render/wgsl-worker.js', import.meta.url), { type: 'module' });
    worker.postMessage({ init: compilers });
    worker.onmessage = ({ data: { id, wgsl, error } }) => {
      const { resolve, reject } = pending.get(id);
      pending.delete(id);
      if (error === undefined) resolve(wgsl); else reject(Error(error));
    };
  }
  const id = next++;
  return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); worker.postMessage({ id, source, stage }); });
}
