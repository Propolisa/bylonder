// Materials of Blender's shader nodes exported as Babylon's own blocks (io_scene_babylon/node-material-export.js): a
// scene of them loads in another process that has only @babylonjs/core, and each material builds there, with
// Babylon's clearcoat for a second lobe when EEVEE Parity is on, and compiles to WGSL on WebGPU.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FreeCamera, MeshBuilder, NodeMaterial, NullEngine, Scene, SceneSerializer, Vector3 } from '@babylonjs/core';
import { nodeMaterialFromTree } from '../src/nodes/blender/shader-nodes.js';
import { exportNodeMaterial } from '../src/io_scene_babylon/node-material-export.js';
import { webgpuSamplers } from '../src/overrides/webgpu/samplers.js';
import { compilersPresent, createCompilers, WebGPUShaderEngine } from './webgpu-shaders.js';

const engine = new NullEngine(), scene = new Scene(engine);
const TREES = {
  Checker: [[['ShaderNodeTexChecker', 'Checker'], ['ShaderNodeBsdfDiffuse', 'Diffuse']], [['Checker', 'Color', 'Diffuse', 'Color'], ['Diffuse', 'BSDF', 'Material Output', 'Surface']]],
  'Two Lobes': [[['ShaderNodeBsdfDiffuse', 'Diffuse'], ['ShaderNodeBsdfGlossy', 'Glossy'], ['ShaderNodeMixShader', 'Mix']],
    [['Diffuse', 'BSDF', 'Mix', 'Shader'], ['Glossy', 'BSDF', 'Mix', 'Shader_001'], ['Mix', 'Shader', 'Material Output', 'Surface']]],
  Ramp: [[['ShaderNodeTexNoise', 'Noise'], ['ShaderNodeValToRGB', 'Ramp', { color_ramp: { color_mode: 'RGB', interpolation: 'LINEAR', hue_interpolation: 'NEAR',
    elements: [{ position: 0, color: [0, 0, 0, 1] }, { position: 0.5, color: [1, 0, 0, 1] }, { position: 1, color: [1, 1, 1, 1] }] } }], ['ShaderNodeEmission', 'Emission']],
    [['Noise', 'Fac', 'Ramp', 'Fac'], ['Ramp', 'Color', 'Emission', 'Color'], ['Emission', 'Emission', 'Material Output', 'Surface']]],
  Glass: [[['ShaderNodeBsdfGlass', 'Glass']], [['Glass', 'BSDF', 'Material Output', 'Surface']]],
  Generated: [[['ShaderNodeTexCoord', 'Coordinates'], ['ShaderNodeBsdfPrincipled', 'Principled']],
    [['Coordinates', 'Object', 'Principled', 'Base Color'], ['Principled', 'BSDF', 'Material Output', 'Surface']]],
};
const materials = Object.entries(TREES).map(([name, [nodes, links]], i) => {
  const tree = { nodes: [...nodes.map(([idname, node, properties]) => ({ idname, name: node, properties })), { idname: 'ShaderNodeOutputMaterial', name: 'Material Output' }], links };
  const { material } = nodeMaterialFromTree(name, scene, tree);
  Object.assign(MeshBuilder.CreateSphere(name, {}, scene), { material }).position.x = i;
  return material;
});
for (let i = 0; i < 50 && materials.some((m) => !m._sharedData || m._buildIsInProgress); i++) await new Promise((resolve) => setTimeout(resolve, 50));

const json = await SceneSerializer.SerializeAsync(scene);
const exported = async (parity) => ({ ...json, materials: await Promise.all(materials.map((m) => exportNodeMaterial(m, { parity }))) });
const classes = (material) => material.blocks.map((b) => b.customType);
for (const parity of [false, true]) {
  const scene = await exported(parity);
  assert.ok(scene.materials.every((m) => classes(m).every((c) => /^BABYLON\.(?!Blender|Shader|Curves)/.test(c))), "only Babylon's own blocks");
  const custom = (m) => m.blocks.filter((b) => b.customType === 'BABYLON.CustomBlock').map((b) => b.name);
  assert.deepEqual(scene.materials.map((m) => custom(m).sort().join()), Object.keys(TREES).map((name) => (parity && name !== 'Ramp' ? 'blender:nodes,blender:viewEye' : 'blender:nodes')),
    "the nodes' code is the one CustomBlock without EEVEE Parity; with it, a lit surface's view eye too");
  const lobes = scene.materials.find((m) => m.name === 'Two Lobes');
  assert.equal(classes(lobes).includes('BABYLON.ClearCoatBlock'), parity, 'the second lobe is a clearcoat with EEVEE Parity');
  assert.ok(classes(scene.materials.find((m) => m.name === 'Ramp')).includes('BABYLON.ImageSourceBlock'), "a color ramp's table is an image");
  assert.ok(materials.every((m) => m.separateCullingPass) && scene.materials.every((m) => !m.separateCullingPass),
    "an opaque surface draws in one pass: the page's faces never reversed, its back faces shade as back faces");

  // Loaded by a process that has only Babylon.
  const dir = mkdtempSync(join(tmpdir(), 'bylonder-nodes-'));
  writeFileSync(join(dir, 'scene.babylon'), JSON.stringify(scene));
  writeFileSync(join(dir, 'load.mjs'), `import { NullEngine, Scene, AppendSceneAsync } from ${JSON.stringify(import.meta.resolve('@babylonjs/core'))};
import { readFileSync } from 'node:fs';
const scene = new Scene(new NullEngine());
await AppendSceneAsync('data:' + readFileSync(${JSON.stringify(join(dir, 'scene.babylon'))}, 'utf8'), scene);
const results = await Promise.all(scene.materials.map((m) => new Promise((resolve) => {
  if (m._buildWasSuccessful) return resolve([m.name, true, m.compilationString?.length]);
  m.onBuildObservable.addOnce(() => resolve([m.name, true]));
  m.onBuildErrorObservable.addOnce((e) => resolve([m.name, String(e)]));
  m.build();
})));
console.log(JSON.stringify({ results, meshes: scene.meshes.map((m) => m.material?.getClassName()) }));`);
  const output = execFileSync(process.execPath, [join(dir, 'load.mjs')], { encoding: 'utf8' });
  rmSync(dir, { recursive: true });
  const { results, meshes } = JSON.parse(output.trim().split('\n').at(-1));
  assert.deepEqual(results.map(([name, ok]) => [name, ok]), Object.keys(TREES).map((name) => [name, true]), `every material builds in plain Babylon (parity ${parity})`);
  assert.deepEqual(meshes, Object.keys(TREES).map(() => 'NodeMaterial'));
}
const glass = materials.find((m) => m.name === 'Glass');
glass.alpha = 0.5;
assert.ok((await exportNodeMaterial(glass)).separateCullingPass, 'a blended surface keeps its back faces drawn first');
glass.alpha = 1;
// On WebGPU, with the page's sampler specialization: a color ramp's table passed to Blender's functions compiles to WGSL.
if (compilersPresent()) {
  const gpu = new WebGPUShaderEngine(await createCompilers()), view = new Scene(gpu);
  new FreeCamera('camera', new Vector3(0, 0, -5), view);
  const createRawTexture = gpu.createRawTexture.bind(gpu);
  gpu.createRawTexture = (...args) => Object.assign(createRawTexture(...args), { isReady: true });
  for (const entry of (await exported(false)).materials) {
    const material = webgpuSamplers(NodeMaterial.Parse(entry, view)), mesh = Object.assign(MeshBuilder.CreateSphere(entry.name, {}, view), { material });
    const from = gpu.results.length;
    let drawn = false;
    for (let i = 0; i < 300 && !drawn; i++) { drawn = material.isReadyForSubMesh(mesh, mesh.subMeshes[0]); await new Promise((resolve) => setTimeout(resolve, 10)); }
    assert.ok(drawn, `${entry.name} compiles on WebGPU`);
    for (const { errors } of gpu.results.slice(from)) assert.deepEqual(errors, [], entry.name);
  }
}
console.log('Export node materials: Blender shader nodes load and build in plain Babylon, a second lobe as its clearcoat with EEVEE Parity, and compile to WGSL');
