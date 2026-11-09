// SPDX-License-Identifier: MIT OR Apache-2.0
// Override of Babylon's shadow shaders on WebGPU: each shadow's depth metric derived in the fragment stage from the light-space position instead of passed beside it, as WebGPU passes at most 28 values between stages and packs no floats together; goes when Babylon derives it there itself.
// Babylon's shadowsVertex: the metric is the position's z offset and scaled by the light's depth values, both linear.
const DECLARATION = /\bvarying\s+float\s+vDepthMetric\d+(\[[^\]]*\])?\s*;/g;
const ASSIGNMENT = /\bvDepthMetric(\d+)(\[\w+\])?\s*=\s*\(-?vPositionFromLight\1\2\.z\+light\1\.depthValues\.x\)\/light\1\.depthValues\.y;/g;
const USE = /\bvDepthMetric(\d+)(\[[^\]]+\])?/g;
const SIGN = '#ifdef USE_REVERSE_DEPTHBUFFER\n#define BL_DEPTH_METRIC_SIGN -1.0\n#else\n#define BL_DEPTH_METRIC_SIGN 1.0\n#endif\n';
const metric = (_, light, index = '') => `((BL_DEPTH_METRIC_SIGN*vPositionFromLight${light}${index}.z+light${light}.depthValues.x)/light${light}.depthValues.y)`;

// A shader stage's code after its includes, its depth metrics derived in the fragment stage.
export function deriveDepthMetrics(shaderType, code) {
  const declared = code.replace(DECLARATION, '');
  if (declared === code) return code;
  return shaderType === 'vertex' ? declared.replace(ASSIGNMENT, '') : SIGN + declared.replace(USE, metric);
}

// The engine, its GLSL effects deriving their depth metrics in the fragment stage (Babylon's processCodeAfterIncludes).
export function depthMetricVaryings(engine) {
  const create = engine.createEffect.bind(engine);
  engine.createEffect = (baseName, options, ...args) => {
    if (options?.attributes !== undefined && !options.shaderLanguage) {
      const after = options.processCodeAfterIncludes;
      options = { ...options, processCodeAfterIncludes: (type, code, defines) => deriveDepthMetrics(type, after ? after(type, code, defines) : code) };
    }
    return create(baseName, options, ...args);
  };
  return engine;
}
