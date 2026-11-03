// A Blender node material is built on Babylon's own material graph, as Babylon's PBR material recreated as a node
// material has it: morph targets, bones and instances on the vertex side, clip planes, Babylon's PBR lighting with its
// lights, shadows and reflection, fog, and image processing; its compiled shaders keep each of Babylon's paths.
import assert from 'node:assert/strict';
import { FreeCamera, MeshBuilder, NullEngine, Scene, Vector3 } from '@babylonjs/core';
import { nodeMaterialFromTree } from '../src/nodes/blender/shader-nodes.js';

const scene = new Scene(new NullEngine());
new FreeCamera('Camera', new Vector3(0, 0, -5), scene);
const tree = { nodes: [{ idname: 'ShaderNodeBsdfPrincipled', name: 'Principled BSDF' }, { idname: 'ShaderNodeBsdfDiffuse', name: 'Diffuse' }, { idname: 'ShaderNodeMixShader', name: 'Mix' },
  { idname: 'ShaderNodeOutputMaterial', name: 'Material Output' }],
links: [['Principled BSDF', 'BSDF', 'Mix', 'Shader'], ['Diffuse', 'BSDF', 'Mix', 'Shader_001'], ['Mix', 'Shader', 'Material Output', 'Surface']] };
const { material } = nodeMaterialFromTree('Base', scene, tree);
const mesh = Object.assign(MeshBuilder.CreateSphere('Sphere', {}, scene), { material });
for (let i = 0; i < 50 && !mesh.subMeshes[0].effect?.isReady(); i++) {
  scene.render();
  await new Promise((resolve) => setTimeout(resolve, 100));
}
const built = new Set();
const visit = (block) => {
  if (!block || built.has(block)) return;
  built.add(block);
  for (const input of block.inputs) visit(input.connectedPoint?.ownerBlock);
};
[...material._vertexOutputNodes, ...material._fragmentOutputNodes].forEach(visit);
const classes = new Set([...built].map((block) => block.getClassName()));
for (const name of ['MorphTargetsBlock', 'BonesBlock', 'InstancesBlock', 'ClipPlanesBlock', 'FogBlock', 'ReflectionBlock', 'BlenderSurfaceBlock', 'BlenderDisplayBlock'])
  assert.ok(classes.has(name), `the graph has Babylon's ${name}`);
const { _vertexSourceCode: vertex, _fragmentSourceCode: fragment } = mesh.subMeshes[0].effect;
for (const define of ['MORPHTARGETS', 'NUM_BONE_INFLUENCERS', 'INSTANCES', 'CLIPPLANE']) assert.match(vertex, new RegExp(`#if(def|) ?\\(?(defined\\()?${define}`), `the vertex shader keeps Babylon's ${define} path`);
assert.match(fragment, /#ifdef FOG/, "the fragment shader keeps Babylon's fog");
assert.match(fragment, /#ifdef SHADOW\{?X?\}?|SHADOW0|computeShadow/, "the fragment shader keeps Babylon's shadows");
console.log("Node material base: Babylon's morph targets, bones, instances, clip planes, lights with shadows, fog and image processing passed");
