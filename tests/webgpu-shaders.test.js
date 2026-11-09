// Bylonder's shaders as WebGPU compiles them: each processed by Babylon's WebGPU shader processor and converted to WGSL
// by the glslang and Tint builds the app serves, with no glslang error and nothing in the WGSL that WebGPU rejects (a
// NaN constant, an explicitly strided array). The floor grid, the volume passes, and a Principled (PBR) and a node
// material drawing hair, lit by an area light.
import assert from 'node:assert/strict';
import { Scene, FreeCamera, Vector3, MeshBuilder, PBRMaterial, RectAreaLight, EffectWrapper } from '@babylonjs/core';
import '@babylonjs/core/Shaders/postprocess.vertex.js';
import { compilersPresent, createCompiler, WebGPUShaderEngine } from './webgpu-shaders.js';
import { createGridOverlay } from '../src/draw/overlay-grid.js';
import { INTEGRATION, RESOLVE, scatterShader } from '../src/draw/volume-shaders.js';
import { engineGLSL } from '../src/nodes/blender/glsl.js';
import { materialsFromGLSL } from '../src/render/gpu-engine.js';
import { CurvesPlugin } from '../src/draw/curves.js';
import { BlenderNodeMaterial, blenderDefaultTree, buildMaterial } from '../src/nodes/blender/shader-nodes.js';
import '../src/blenkernel/light/area-specular.js';

if (!compilersPresent()) {
  console.log('WebGPU shaders: skipped, no public/webgpu compilers (npm run dev or npm run build fetches them)');
  process.exit(0);
}
const engine = new WebGPUShaderEngine(await createCompiler());
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
materialsFromGLSL();
const principled = new PBRMaterial('Principled hair', scene);
assert.ok(CurvesPlugin.draws(principled), 'the Principled material draws curves');
await compiled('Principled hair', hair(principled));
const nodes = new BlenderNodeMaterial('Node hair', scene);
blenderDefaultTree(nodes);
buildMaterial(nodes);
await compiled('node material hair', hair(nodes));
console.log(`WebGPU shaders: ${engine.results.length} effects convert to WGSL that WebGPU accepts`);
