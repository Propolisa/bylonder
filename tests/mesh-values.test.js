import assert from 'node:assert/strict';
import { InputBlock, MeshBuilder, NodeMaterial, NodeMaterialBlockConnectionPointTypes as T, NullEngine, Scene } from '@babylonjs/core';
import { MESH_VALUE, meshValues } from '../src/io_scene_babylon/runtime/materials.js';

// A page's material shared by meshes of other sizes (Carousel's Cobbles on the square and the lamp posts) gives each
// mesh its own texture space, in Blender's axes, as the app does.
const scene = new Scene(new NullEngine());
const material = new NodeMaterial('Cobbles', scene);
for (const id of ['$texspace_location', '$texspace_size']) material.attachedBlocks.push(Object.assign(new InputBlock(MESH_VALUE + id, undefined, T.Vector3), { associatedVariableName: id }));
const set = {};
material.getEffect = () => ({ setFloat3: (name, ...v) => { set[name] = v; } });
meshValues(material);
const square = MeshBuilder.CreateBox('Square', { width: 40, height: 0.2, depth: 30 }, scene), post = MeshBuilder.CreateBox('Post', { width: 0.14, height: 3.2, depth: 0.14 }, scene);
const close = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-5);
material.onBindObservable.notifyObservers(square);
assert.ok(close(set.$texspace_size, [20, 15, 0.1]) && close(set.$texspace_location, [0, 0, 0]), `the square's: ${JSON.stringify(set)}`);
material.onBindObservable.notifyObservers(post);
assert.ok(close(set.$texspace_size, [0.07, 0.07, 1.6]), `the post's: ${JSON.stringify(set)}`);
console.log("Mesh values: a shared material spans each mesh's own texture space in the page");
