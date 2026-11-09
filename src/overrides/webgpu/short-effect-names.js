// SPDX-License-Identifier: MIT OR Apache-2.0
// Override of Babylon's WebGPU pipeline context name: a hash of the effect's key when it is long, as Babylon names the uniform buffer after the key, which for a material built from source (a node material) is its whole GLSL, the GPU buffer's label copied at every creation; goes when Babylon names it briefly.
import { WebGPUPipelineContext } from '@babylonjs/core/Engines/WebGPU/webgpuPipelineContext.js';

class ShortNamedPipelineContext extends WebGPUPipelineContext {
  get _name() { return this.shortName; }
  set _name(name) { this.shortName = name.length > 64 ? `effect-${fnv1a(name)}` : name; }
}
const fnv1a = (text) => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
  return (hash >>> 0).toString(16).padStart(8, '0');
};

export function shortEffectNames(engine) {
  engine.createPipelineContext = (context) => new ShortNamedPipelineContext(context, engine);
  return engine;
}
