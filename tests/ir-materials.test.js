// Materials on the IR (runtime/materials.js): a material's nodes, made into per-node kernels at export, are fused again
// from the IR graph alone: into an exported material's node block, or into a NodeMaterial of Babylon's own blocks. The
// result builds, compiles to WGSL as Babylon's WebGPU engine does, and draws each graph of one structure with one body;
// a unit registered for node:ShaderNodeTexNoise takes over that node with nothing else changed.
import assert from 'node:assert/strict';
import { FreeCamera, MeshBuilder, NullEngine, Scene, Vector3, NodeMaterial } from '@babylonjs/core';
import { nodeMaterialFromTree } from '../src/nodes/blender/shader-nodes.js';
import { exportNodeKernels, exportNodeMaterial, materialKernels } from '../src/io_scene_babylon/node-material-export.js';
import { buildNodeMaterial, fillMaterials, fuse } from '../src/io_scene_babylon/runtime/materials.js';
import { register, unregister } from '../src/io_scene_babylon/runtime/units.js';
import { compilersPresent, createCompilers, WebGPUShaderEngine } from './webgpu-shaders.js';

const RAMP = { color_ramp: { color_mode: 'RGB', interpolation: 'LINEAR', hue_interpolation: 'NEAR',
  elements: [{ position: 0, color: [0, 0, 0, 1] }, { position: 0.5, color: [1, 0, 0, 1] }, { position: 1, color: [1, 1, 1, 1] }] } };
const TREES = {
  Lava: [[['ShaderNodeTexNoise', 'Noise'], ['ShaderNodeValToRGB', 'Ramp', RAMP], ['ShaderNodeBsdfPrincipled', 'Principled']],
    [['Noise', 'Fac', 'Ramp', 'Fac'], ['Ramp', 'Color', 'Principled', 'Base Color'], ['Ramp', 'Color', 'Principled', 'Emission Color'], ['Principled', 'BSDF', 'Material Output', 'Surface']]],
  'Lava 2': [[['ShaderNodeTexNoise', 'Noise'], ['ShaderNodeValToRGB', 'Ramp', RAMP], ['ShaderNodeBsdfPrincipled', 'Principled']],
    [['Noise', 'Fac', 'Ramp', 'Fac'], ['Ramp', 'Color', 'Principled', 'Base Color'], ['Ramp', 'Color', 'Principled', 'Emission Color'], ['Principled', 'BSDF', 'Material Output', 'Surface']]],
  Planet: [[['ShaderNodeTexCoord', 'Coordinates'], ['ShaderNodeTexNoise', 'Noise'], ['ShaderNodeMath', 'Math', { operation: 'MULTIPLY' }], ['ShaderNodeBsdfDiffuse', 'Diffuse'],
    ['ShaderNodeBsdfGlossy', 'Glossy'], ['ShaderNodeMixShader', 'Mix']],
  [['Coordinates', 'Object', 'Noise', 'Vector'], ['Noise', 'Color', 'Diffuse', 'Color'], ['Noise', 'Fac', 'Math', 'Value'], ['Math', 'Value', 'Mix', 'Fac'],
    ['Diffuse', 'BSDF', 'Mix', 'Shader'], ['Glossy', 'BSDF', 'Mix', 'Shader_001'], ['Mix', 'Shader', 'Material Output', 'Surface']]],
  // A value linked into a shader input: an Emission of it, as Blender casts it.
  Glow: [[['ShaderNodeTexNoise', 'Noise']], [['Noise', 'Color', 'Material Output', 'Surface']]],
};

const engine = new NullEngine(), scene = new Scene(engine);
const materials = Object.entries(TREES).map(([name, [nodes, links]], i) => {
  const tree = { nodes: [...nodes.map(([idname, node, properties]) => ({ idname, name: node, properties })), { idname: 'ShaderNodeOutputMaterial', name: 'Material Output' }], links };
  const { material } = nodeMaterialFromTree(name, scene, tree);
  Object.assign(MeshBuilder.CreateSphere(name, {}, scene), { material }).position.x = i;
  return [material, tree];
});
for (let i = 0; i < 50 && materials.some(([m]) => !m._sharedData || m._buildIsInProgress); i++) await new Promise((resolve) => setTimeout(resolve, 50));

// The IR as the export writes it (ir-graphs.js): each tree a graph, its unlinked inputs by socket, the Noise scales as
// properties a page sets.
const ir = { schema: 'bylonder-ir', version: 1, ids: {}, references: [], properties: {}, graphs: {}, entities: {}, order: [] };
const key = (name) => `MA:${name}/node_tree`;
for (const [material, tree] of materials) {
  const linked = new Set(tree.links.map(([, , to, input]) => `${to}\0${input}`));
  ir.graphs[key(material.name)] = { type: 'SHADER', links: tree.links, nodes: tree.nodes.map(({ idname, name, properties }) => {
    const block = material.attachedBlocks.find((b) => b.name === name);
    const inputs = Object.fromEntries(Object.entries(block.values).filter(([id]) => !linked.has(`${name}\0${id}`)).map(([id, value]) => {
      if (idname !== 'ShaderNodeTexNoise' || id !== 'Scale') return [id, value];
      const path = `materials["${material.name}"].node_tree.nodes["${name}"].inputs[2].default_value`;
      ir.properties[path] = { id: `MA:${material.name}`, type: 'FLOAT', default: value };
      return [id, { property: path }];
    }));
    return { name, type: `node:${idname}`, settings: properties ?? {}, inputs };
  }) };
}

const kernels = { functions: {}, pieces: {}, graphs: {} };
for (const [material] of materials) assert.ok(await exportNodeKernels(material, key(material.name), { into: kernels }), `${material.name}: kernels`);
assert.ok(Object.keys(kernels.pieces).every((name) => kernels.pieces[name].code.includes(`void ${name}(`)), 'each piece is one function named by its code');
const source = await materialKernels(materials.map(([material]) => [material, key(material.name)]));
assert.match(source, /^\/\/ SPDX-License-Identifier: GPL-3\.0-or-later\n/, "the package's kernels file is GPL");
assert.deepEqual((await import(`data:text/javascript,${encodeURIComponent(source)}`)).default, kernels, 'and holds the kernels');
const pieces = (name) => Object.values(kernels.graphs[key(name)].nodes).map((n) => n.piece).sort();
assert.deepEqual(pieces('Lava 2'), pieces('Lava'), 'materials of one structure share their nodes\' functions');
const body = (name) => fuse(ir, key(name), { kernels, sources: (source) => source }).code([]).join('\n');
assert.equal(body('Lava 2'), body('Lava'), 'and their body');

const ready = async (material) => {
  for (let i = 0; i < 100 && !material._buildWasSuccessful; i++) await new Promise((resolve) => setTimeout(resolve, 20));
  return material._buildWasSuccessful;
};

// An exported material's node block filled from the IR.
for (const [material] of materials) {
  const entry = await exportNodeMaterial(material, { graph: key(material.name) });
  const nodes = entry.blocks.find((b) => b.name === 'blender:nodes');
  assert.deepEqual(nodes.options.code, [], `${material.name}: the export ships no code for its nodes`);
  fillMaterials([entry], ir, kernels);
  assert.match(nodes.options.code.join('\n'), /void bl_nodes\(/, `${material.name}: the page makes it from the IR`);
  const parsed = NodeMaterial.Parse(entry, new Scene(engine));
  assert.ok(await ready(parsed), `${material.name}: the filled material builds`);
}

// From the IR alone, on Babylon's WebGPU path: compiled by glslang and Tint.
const compiler = compilersPresent() ? await createCompilers() : null;
const gpu = compiler ? new WebGPUShaderEngine(compiler) : new NullEngine(), view = new Scene(gpu);
new FreeCamera('camera', new Vector3(0, 0, -5), view);
// A color ramp's table, which a NullEngine never marks as uploaded.
const createRawTexture = gpu.createRawTexture.bind(gpu);
gpu.createRawTexture = (...args) => Object.assign(createRawTexture(...args), { isReady: true });
const compiled = async (material) => {
  assert.ok(await ready(material), `${material.name}: builds from the IR`);
  if (!compiler) return;
  const mesh = Object.assign(MeshBuilder.CreateSphere(material.name, {}, view), { material }), from = gpu.results.length;
  let drawn = false;
  for (let i = 0; i < 300 && !drawn; i++) { drawn = material.isReadyForSubMesh(mesh, mesh.subMeshes[0]); await new Promise((resolve) => setTimeout(resolve, 10)); }
  // A material of the same shader as one before reuses its effect.
  assert.ok(drawn, `${material.name}: compiled`);
  for (const { errors } of gpu.results.slice(from)) assert.deepEqual(errors, [], material.name);
};
for (const [material] of materials) await compiled(buildNodeMaterial(ir, key(material.name), view, { kernels, name: `${material.name} (IR)` }));

// A stand-in for Noise Texture takes over every Noise node.
register('node:ShaderNodeTexNoise', {
  shader: (node) => ({ functions: {}, call: 'stand_in_noise', code: 'void stand_in_noise(float scale, out float fac, out vec4 color) { fac = 0.5 * scale; color = vec4(vec3(fac), 1.0); }',
    params: [{ input: 'Scale', type: 'float' }, { output: 'Fac', type: 'float' }, { output: 'Color', type: 'vec4' }] }),
});
try {
  const noise = Object.values(kernels.graphs[key('Planet')].nodes).find((n) => kernels.pieces[n.piece].params.some((p) => p.input === 'Detail')).piece;
  const material = buildNodeMaterial(ir, key('Planet'), view, { kernels, name: 'Planet (stand-in)' });
  await compiled(material);
  const fragment = material._fragmentCompilationState._builtCompilationString;
  assert.match(fragment, /stand_in_noise\(/, 'the stand-in runs');
  assert.ok(!fragment.includes(`${noise}(`), "the package's noise does not");
} finally {
  unregister('node:ShaderNodeTexNoise');
}
console.log(`IR materials: ${materials.length} graphs fused from ${Object.keys(kernels.pieces).length} node functions, built${compiler ? ' and compiled to WGSL' : ''}; a stand-in Noise unit takes over`);
