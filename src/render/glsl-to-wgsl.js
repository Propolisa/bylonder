// GLSL to WGSL as WebGPU takes it, with Babylon's glslang and Tint (twgsl) builds: the GLSL's WGSL-reserved names
// renamed (overrides/webgpu/reserved-names.js) and WGSL's derivative uniformity analysis off, as GLSL has no such rule.
// One stage at a time; glslang's log is the error.
import { wgslNames } from '../overrides/webgpu/reserved-names.js';

const UNIFORMITY_OFF = 'diagnostic(off, derivative_uniformity);\n';

export function glslToWGSL({ glslang, twgsl }, source, stage) {
  return UNIFORMITY_OFF + twgsl.convertSpirV2WGSL(glslang.compileGLSL(wgslNames(source), stage, false));
}

// The GLSL Babylon's WebGPU engine hands glslang for an effect's stage (its _compilePipelineStageDescriptor).
export const stageSource = (code, defines, raw) => (raw ? code : `#version 450\n${defines ? `${defines}\n` : ''}${code}`);
