// WebGPU passes at most 28 values between a shader's stages and, unlike WebGL 2, packs no floats together, so a
// material lit by several shadow-casting lights runs out (a sun's four cascades take nine). Babylon passes each shadow's
// depth metric beside its light-space position, from which the fragment stage derives it exactly (shadowsVertex: the
// position's z offset and scaled by the light's depth values, both linear): here it is derived there instead.
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
