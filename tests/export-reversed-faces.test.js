// A blended two-sided material in an exported page shades its back faces as back faces, as the app does: Babylon draws
// its back faces in a pass of their own with their winding reversed, and the page tells the material's nodes so
// (bl_reversed_faces, set per pass by runtime/materials.js meshValues), where it used to assume no face is reversed.
import assert from 'node:assert/strict';
import { MeshBuilder, NodeMaterial, NullEngine, Scene } from '@babylonjs/core';
import { nodeMaterialFromTree } from '../src/nodes/blender/shader-nodes.js';
import { exportNodeMaterial } from '../src/io_scene_babylon/node-material-export.js';
import { MESH_VALUE, REVERSED_FACES, REVERSED_GLOBAL, meshValues } from '../src/io_scene_babylon/runtime/materials.js';

const scene = new Scene(new NullEngine());
const tree = { nodes: [{ idname: 'ShaderNodeBsdfPrincipled', name: 'Principled' }, { idname: 'ShaderNodeOutputMaterial', name: 'Material Output' }],
  links: [['Principled', 'BSDF', 'Material Output', 'Surface']] };
const { material } = nodeMaterialFromTree('Veil', scene, tree);
const sphere = Object.assign(MeshBuilder.CreateSphere('Veil', {}, scene), { material });
for (let i = 0; i < 50 && (!material._sharedData || material._buildIsInProgress); i++) await new Promise((resolve) => setTimeout(resolve, 50));
Object.assign(material, { alpha: 0.5, backFaceCulling: false });

const json = await exportNodeMaterial(material);
assert.ok(json.separateCullingPass && !json.backFaceCulling, 'a blended two-sided surface draws its back faces first');
const nodes = json.blocks.find((b) => b.name === 'blender:nodes'), code = nodes.options.code.join('\n');
assert.ok(json.blocks.some((b) => b.name === MESH_VALUE + REVERSED_FACES), 'it takes whether faces are reversed as a mesh value');
assert.ok(code.includes(REVERSED_GLOBAL) && code.includes('bl_reversed_faces = bl_reversed;'), "its nodes' FrontFacing reads it");

const page = NodeMaterial.Parse(json, scene), set = [];
meshValues(page);
page.getEffect = () => ({ setFloat: (name, value) => set.push(value), setFloat3: () => {} });
page.onBindObservable.notifyObservers(sphere);
sphere.onBetweenPassObservable.notifyObservers({ effect: { setFloat: (name, value) => set.push(value) } });
assert.deepEqual(set, [1, 0], 'reversed in the back faces pass, not in the front faces pass');
console.log('Export: a blended two-sided material shades its back faces as back faces');
