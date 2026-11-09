// WebGPU: a shadow's depth metric is derived in the fragment stage from the light-space position the vertex stage
// passes, not passed beside it, so materials lit by several shadow-casting lights stay within WebGPU's 28 inter-stage
// values. Checked on Babylon's own light includes, a plain shadow (light 0) and a sun's cascades (light 1).
import assert from 'node:assert/strict';
import { ShaderStore } from '@babylonjs/core/Engines/shaderStore.js';
import '@babylonjs/core/Shaders/ShadersInclude/lightVxUboDeclaration.js';
import '@babylonjs/core/Shaders/ShadersInclude/lightUboDeclaration.js';
import '@babylonjs/core/Shaders/ShadersInclude/shadowsVertex.js';
import '@babylonjs/core/Shaders/ShadersInclude/lightFragment.js';
import { deriveDepthMetrics } from '../src/render/depth-metric-varyings.js';

const store = ShaderStore.IncludesShadersStore;
const lights = (...names) => [0, 1].map((x) => names.map((name) => store[name]).join('\n').replaceAll('{X}', x)).join('\n');
const vertex = deriveDepthMetrics('vertex', lights('lightVxUboDeclaration', 'shadowsVertex'));
const fragment = deriveDepthMetrics('fragment', lights('lightUboDeclaration', 'lightFragment'));

assert.doesNotMatch(vertex, /vDepthMetric\d/, 'the vertex stage passes no depth metric');
assert.match(vertex, /vPositionFromLight0=lightMatrix0\*worldPos;/, 'it passes the light-space position');
assert.doesNotMatch(fragment, /vDepthMetric\d/, 'the fragment stage reads none');
assert.match(fragment, /\(\(BL_DEPTH_METRIC_SIGN\*vPositionFromLight0\.z\+light0\.depthValues\.x\)\/light0\.depthValues\.y\)/, 'a shadow derives it');
assert.match(fragment, /vPositionFromLight1\[index1\]\.z\+light1\.depthValues\.x/, 'a cascade derives it');
assert.match(fragment, /^#ifdef USE_REVERSE_DEPTHBUFFER\n#define BL_DEPTH_METRIC_SIGN -1\.0/, 'reversed depth negates the z as Babylon does');
assert.equal(deriveDepthMetrics('fragment', 'void main() {}'), 'void main() {}', 'a shader without shadows is unchanged');
console.log('Depth metric varyings: shadows derive their depth metric in the fragment stage, one value fewer per shadow, four per sun with cascades');
