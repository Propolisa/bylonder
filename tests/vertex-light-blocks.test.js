// WebGPU: a vertex stage declares only the light blocks it reads, each a uniform buffer of its own, so a material lit by
// 8 lights stays within the 12 uniform buffers a stage may have. Checked on Babylon's own light includes after the depth
// metrics move to the fragment stage: a shadowless light (0) and a shadowed one (1), whose vertex stage reads no block,
// and Babylon's vertex code reading a light's depth values, which keeps its block.
import assert from 'node:assert/strict';
import { ShaderStore } from '@babylonjs/core/Engines/shaderStore.js';
import '@babylonjs/core/Shaders/ShadersInclude/lightVxUboDeclaration.js';
import '@babylonjs/core/Shaders/ShadersInclude/lightUboDeclaration.js';
import '@babylonjs/core/Shaders/ShadersInclude/shadowsVertex.js';
import { deriveDepthMetrics } from '../src/overrides/webgpu/depth-metric-varyings.js';
import { vertexLightBlocks } from '../src/overrides/webgpu/vertex-light-blocks.js';

const store = ShaderStore.IncludesShadersStore;
const lights = (...names) => [0, 1].map((x) => names.map((name) => store[name]).join('\n').replaceAll('{X}', x)).join('\n');
const babylon = lights('lightVxUboDeclaration', 'shadowsVertex');
const vertex = vertexLightBlocks('vertex', deriveDepthMetrics('vertex', babylon));

assert.doesNotMatch(vertex, /uniform\s+Light\d/, 'no light block in the vertex stage');
assert.match(vertex, /uniform mat4 lightMatrix1;/, "a shadow's light matrix stays");
assert.equal((vertexLightBlocks('vertex', babylon).match(/uniform\s+Light\d/g) ?? []).length, 2, 'blocks the vertex stage reads stay');
const fragment = lights('lightUboDeclaration');
assert.equal(vertexLightBlocks('fragment', fragment), fragment, 'the fragment stage keeps its blocks');
console.log('Vertex light blocks: a vertex stage declares no light block it does not read');
