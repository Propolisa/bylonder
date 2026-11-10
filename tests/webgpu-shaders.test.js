// Bylonder's shaders as WebGPU compiles them: each processed by Babylon's WebGPU shader processor and converted to WGSL
// by the glslang and Tint builds the app serves, with no glslang error and nothing in the WGSL that WebGPU rejects (a
// NaN constant, an explicitly strided array). The floor grid, the volume passes, a Principled (PBR) and a node material
// drawing hair, lit by an area light, a shader of the user's naming what WGSL reserves and one declaring uniforms in
// lists; and every converted GLSL shader keeps GLSL's freedom to take derivatives in any control flow.
import assert from 'node:assert/strict';
import { Scene, FreeCamera, Vector3, MeshBuilder, PBRMaterial, RectAreaLight, EffectWrapper, ShaderMaterial, WebGPUEngine } from '@babylonjs/core';
import '@babylonjs/core/Shaders/postprocess.vertex.js';
import { compilersPresent, createCompilers, WebGPUShaderEngine } from './webgpu-shaders.js';
import { createGridOverlay } from '../src/draw/overlay-grid.js';
import { INTEGRATION, RESOLVE, scatterShader } from '../src/draw/volume-shaders.js';
import { engineGLSL } from '../src/nodes/blender/glsl.js';
import { pbrFromGLSL } from '../src/overrides/webgpu/pbr-from-glsl.js';
import { shortEffectNames } from '../src/overrides/webgpu/short-effect-names.js';
import { derivativeUniformity } from '../src/overrides/webgpu/derivative-uniformity.js';
import { declarationLists } from '../src/overrides/webgpu/declaration-lists.js';
import { readFileSync } from 'node:fs';
import { CurvesPlugin } from '../src/draw/curves.js';
import { BlenderNodeMaterial, blenderDefaultTree, buildMaterial } from '../src/nodes/blender/shader-nodes.js';
import '../src/overrides/babylon/area-light-used.js';
import '../src/overrides/webgpu/area-light-inline.js';

if (!compilersPresent()) {
  console.log('WebGPU shaders: skipped, no public/webgpu compilers (npm run dev or npm run build fetches them)');
  process.exit(0);
}
const engine = declarationLists(new WebGPUShaderEngine(await createCompilers()));
const scene = new Scene(engine);
new FreeCamera('camera', new Vector3(0, 2, -5), scene);
new RectAreaLight('area', new Vector3(0, 2, 0), 1, 1, scene);
// `start` makes the effects and returns what asks for them again until they are compiled.
const compiled = async (name, start) => {
  const from = engine.results.length, poll = start();
  for (let i = 0; i < 300 && engine.results.length === from; i++) {
    poll();
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  const results = engine.results.slice(from);
  assert.ok(results.length, `${name}: compiled`);
  for (const { errors } of results) assert.deepEqual(errors, [], name);
};

await compiled('floor grid', () => {
  const { meshes } = createGridOverlay(scene);
  return () => meshes.forEach((mesh) => mesh.material.isReady(mesh));
});
for (const [name, fragmentShader] of [['volume scatter', scatterShader(['SUN', 'SPOT', 'CUBE'])], ['volume integration', INTEGRATION], ['volume resolve', RESOLVE]]) {
  await compiled(name, () => {
    const { effect } = new EffectWrapper({ engine, name, fragmentShader: engineGLSL(engine, fragmentShader), useShaderStore: false, uniforms: [], samplers: [] });
    return () => effect.isReady();
  });
}
const hair = (material) => () => {
  const mesh = Object.assign(MeshBuilder.CreateBox(material.name, {}, scene), { material, metadata: { curves: { faces: 1 } } });
  return () => material.isReadyForSubMesh(mesh, mesh.subMeshes[0]);
};
pbrFromGLSL();
const principled = new PBRMaterial('Principled hair', scene);
assert.ok(CurvesPlugin.draws(principled), 'the Principled material draws curves');
await compiled('Principled hair', hair(principled));
const nodes = new BlenderNodeMaterial('Node hair', scene);
blenderDefaultTree(nodes);
buildMaterial(nodes);
await compiled('node material hair', hair(nodes));
// A shader naming its uniform, attribute, sampler and a parameter what WGSL reserves converts, its names WGSL's own in
// the code only: the effect binds them by the names it was given.
const reserved = new ShaderMaterial('Reserved names', scene, {
  vertexSource: `precision highp float;
attribute vec3 position;
attribute vec3 from;
uniform mat4 worldViewProjection;
varying vec3 vType;
void main() { vType = from; gl_Position = worldViewProjection * vec4(position, 1.0); }`,
  fragmentSource: `precision highp float;
uniform float let;
uniform sampler2D ref;
varying vec3 vType;
float shade(vec2 from) { return texture2D(ref, from).r * let; }
void main() { gl_FragColor = vec4(vType * shade(vType.xy), 1.0); }`,
}, { attributes: ['position', 'from'], uniforms: ['worldViewProjection', 'let'], samplers: ['ref'] });
const named = MeshBuilder.CreateBox('Reserved', {}, scene);
named.setVerticesData('from', new Float32Array(named.getTotalVertices() * 3), false, 3);
named.material = reserved;
await compiled('a shader naming what WGSL reserves', () => () => reserved.isReady(named));
const { wgsl } = engine.results.at(-1);
assert.match(wgsl.fragment, /bl_from/, 'a parameter named from is bl_from in WGSL');
assert.doesNotMatch(wgsl.fragment + wgsl.vertex, /\b(from|let|ref)\b\s*:/, 'no WGSL-reserved name declared');
const effect = Object.values(engine._compiledEffects).find((e) => e.getUniformNames().includes('let'));
assert.ok(effect?.getSamplers().includes('ref') && effect.getAttributesNames().includes('from'), 'bound by the names it was given');

// The Shader example's wave declares its uniforms in lists (uniform vec3 deep, shallow;), as GLSL allows: each one
// binds.
const example = (name) => readFileSync(new URL(`../examples/shader/shaders/${name}`, import.meta.url), 'utf8');
const wave = new ShaderMaterial('wave', scene, { vertexSource: example('wave.vert.glsl'), fragmentSource: example('wave.frag.glsl') },
  { attributes: ['position', 'uv'], uniforms: ['worldViewProjection', 'time', 'amplitude', 'frequency', 'deep', 'shallow'] });
const water = MeshBuilder.CreateGround('Water', {}, scene);
water.material = wave;
await compiled('a shader declaring uniforms in lists', () => () => wave.isReady(water));
const waveWGSL = engine.results.at(-1).wgsl;
assert.ok(['time', 'amplitude', 'frequency'].every((name) => waveWGSL.vertex.includes(name)) && ['deep', 'shallow'].every((name) => waveWGSL.fragment.includes(name)), 'every listed uniform declared');

// Every converted GLSL shader's WGSL allows derivatives in any control flow (WGSL's derivative_uniformity diagnostic
// off), as GLSL does.
assert.ok(engine.results.every(({ wgsl: { vertex, fragment } }) => [vertex, fragment].every((code) => code.startsWith('diagnostic(off, derivative_uniformity);'))), 'uniformity off');
// An effect built from source names its pipeline context (and so its GPU uniform buffer's label) by a hash of its key,
// not the key's whole GLSL; a short name stays.
const context = shortEffectNames(Object.create(engine)).createPipelineContext(engine._getShaderProcessingContext(0, false));
context._name = `${'precision highp float;'.repeat(400)}+fragment`;
assert.match(context._name, /^effect-[0-9a-f]{8}$/, 'a hash of a long key');
context._name = 'pbr';
assert.equal(context._name, 'pbr', 'a short name as it is');

// The engine of an exported page turns it off for GLSL only; WGSL of Babylon's own keeps its analysis.
const flags = [];
const converting = derivativeUniformity(Object.assign(Object.create(WebGPUEngine.prototype), { _isWebGPU: true,
  _tintWASM: { convertSpirV2WGSL: (code, off) => (flags.push(off), code) }, _device: { createShaderModule: (d) => d } }));
const descriptor = (shaderLanguage) => converting._createPipelineStageDescriptor('vertex', 'fragment', shaderLanguage, false, false);
descriptor(0);
assert.deepEqual(flags, [true, true], 'GLSL: off');
assert.equal(descriptor(1).fragmentStage.module.code, 'fragment', "WGSL: Babylon's as it is");
assert.ok(WebGPUEngine.prototype._createPipelineStageDescriptor, "Babylon's engine compiles its pipelines' stages there");
console.log(`WebGPU shaders: ${engine.results.length} effects convert to WGSL that WebGPU accepts`);
