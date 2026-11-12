// A material of a refraction and a reflection lobe of its own (Snow's cornea: Glossy and Refraction mixed) builds a
// shader the GPU compiles: Babylon's SS_REFRACTION is the material's define, so the lobe's PBR block, which has no
// refraction, builds with it off, where it used to pass its sub-surface block refraction arguments it has none of.
import assert from 'node:assert/strict';
import { FreeCamera, MeshBuilder, NullEngine, RawTexture, Scene, Vector3 } from '@babylonjs/core';
import { nodeMaterialFromTree } from '../src/nodes/blender/shader-nodes.js';

const scene = new Scene(new NullEngine());
new FreeCamera('Camera', new Vector3(0, 0, -5), scene);
scene.environmentTexture = RawTexture.CreateRGBATexture(new Uint8Array(4), 1, 1, scene);
const tree = { nodes: [{ idname: 'ShaderNodeBsdfGlossy', name: 'Glossy' }, { idname: 'ShaderNodeBsdfRefraction', name: 'Refraction' },
  { idname: 'ShaderNodeMixShader', name: 'Mix' }, { idname: 'ShaderNodeOutputMaterial', name: 'Material Output' }],
  links: [['Glossy', 'BSDF', 'Mix', 'Shader'], ['Refraction', 'BSDF', 'Mix', 'Shader_001'], ['Mix', 'Shader', 'Material Output', 'Surface']] };
const { material } = nodeMaterialFromTree('Cornea', scene, tree);
Object.assign(MeshBuilder.CreateSphere('Eye', {}, scene), { material });
for (let i = 0; i < 200 && !material._buildWasSuccessful; i++) await new Promise((r) => setTimeout(r, 20));
const code = material._fragmentCompilationState._builtCompilationString || material._fragmentCompilationState.compilationString;
const calls = code.split('subSurfaceBlock(').slice(1).map((call) => call.slice(0, call.indexOf(');')));
assert.ok(calls.length >= 2, `the surface and its lobe each light the sub-surface (${calls.length} calls)`);
assert.ok(code.includes('#define BL_REFRACTION_ELSEWHERE'), 'the lobe builds with SS_REFRACTION off');
const lobe = code.slice(code.indexOf('#define BL_REFRACTION_ELSEWHERE'), code.indexOf('#undef BL_REFRACTION_ELSEWHERE'));
assert.ok(lobe.includes('subSurfaceBlock('), 'around its sub-surface call');
console.log('Refraction lobes: a material refracting and reflecting in a lobe of its own builds without empty arguments');
