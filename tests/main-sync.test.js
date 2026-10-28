// The scene sync (blenkernel/main-sync.js): Bylonder's Babylon scene and Blender's Main stay equal where they overlap,
// through edits from both sides: Babylon writes, Blender's operators, undo and redo.
import assert from 'node:assert/strict';
import { NullEngine, Scene, MeshBuilder, TransformNode, Vector3, Quaternion, PointLight, SpotLight, FreeCamera, PBRMaterial, Color3 } from '@babylonjs/core';
import { createAnimationModel } from '../src/blenkernel/animation/model.js';
import { createSceneSettings } from '../src/blenkernel/scene/settings.js';
import { createRenderSettings } from '../src/blenkernel/scene/render.js';
import { createCollections } from '../src/blenkernel/scene/collections.js';
import { createMaterialLibrary } from '../src/blenkernel/material/library.js';
import { createWorlds } from '../src/blenkernel/scene/world.js';
import { createModifierSystem, addModifier } from '../src/modifiers/stack.js';
import { createSelection } from '../src/editors/object/selection.js';
import { createRNA } from '../src/makesrna/rna-bylonder.js';
import { createMainSync } from '../src/blenkernel/main-sync.js';
import { buildMesh } from '../src/editors/object/mesh-catalog.js';
import { mesh_serialize } from '../src/blenkernel/mesh/mesh.js';
import { primitive_add } from '../src/editors/mesh/editmesh-add.js';
import { OPERATOR_FINISHED } from '../src/bmesh/bmesh-wasm.js';
import { dnaGet } from '../src/makesrna/dna-struct.js';
import { asObject } from '../src/runtime/object-transform.js';

const scene = new Scene(new NullEngine());
const objects = [];
objects.scene = scene;
const animation = createAnimationModel();
const world = { scene, objects, animation };
world.sceneSettings = createSceneSettings(world);
world.renderSettings = createRenderSettings(world);
world.collections = createCollections(world);
world.materials = createMaterialLibrary(world);
world.worlds = createWorlds(world);
world.modifiers = createModifierSystem(world, { notify: (message) => { throw Error(message); } });
const selection = createSelection(scene, objects);
const rna = createRNA({ world, selection });
const sync = createMainSync({ rna, ids: animation.ids });
sync.debug = true;

const cubeMesh = mesh_serialize(primitive_add('mesh.primitive_cube_add'));
const box = (name, position) => {
  const node = buildMesh(scene, name, { mesh: cubeMesh });
  node.metadata = { wbId: name.toLowerCase(), wbCreation: { mesh: cubeMesh } };
  node.position = new Vector3(...position);
  objects.push(node);
  return node;
};
const cube = box('Cube', [1, 2, 3]), other = box('Other', [-2, 0, 1]);
const empty = new TransformNode('Empty', scene);
empty.metadata = { wbId: 'empty' };
objects.push(empty);
const lamp = new PointLight('Lamp', new Vector3(4, 5, 6), scene);
lamp.metadata = { wbId: 'lamp' };
asObject(lamp);
objects.push(lamp);
const spot = new SpotLight('Spot', new Vector3(0, 3, 0), new Vector3(0, -1, 0), Math.PI / 3, 2, scene);
spot.metadata = { wbId: 'spot' };
asObject(spot);
objects.push(spot);
const camera = new FreeCamera('Camera', new Vector3(7, 3, -7), scene);
camera.metadata = { wbId: 'camera' };
asObject(camera);
objects.push(camera);
const material = new PBRMaterial('Red', scene);
Object.assign(material, { albedoColor: new Color3(0.8, 0.1, 0.1), metallic: 0.2, roughness: 0.4 });
material.metadata = { wbId: 'red' };
cube.material = material;
world.materials.sync();

const { blender } = sync;
const ob = (node) => sync.objectOf(node);
const location = (node) => dnaGet('Object', ob(node), 'location');
const close = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-5);

// Babylon to Main: everything goes in on the first flush, and a write reaches Main by its hook at the end of the task.
sync.flush();
assert.deepEqual(sync.check(), []);
assert.deepEqual(location(cube), [1, 3, 2], "Blender's axes: Babylon's (x, y, z) is Blender's (x, z, y)");
cube.position.x = 5;
await null;
assert.equal(location(cube)[0], 5, 'a write to a Babylon vector reaches Main at the end of the task');
lamp.intensity = 2;
await null;
assert.equal(dnaGet('PointLight', blender.data(ob(lamp)), 'energy'), 2000, "a light's intensity is Blender's watts");
material.albedoColor.g = 0.5;
sync.flush();
assert(close(dnaGet('Material', sync.materialOf(material), 'diffuse_color'), [0.8, 0.5, 0.1, 1]));
assert.equal(blender.materials(ob(cube))[0], sync.materialOf(material), "the cube's slot holds its material in Main");
assert.deepEqual(sync.check(), []);

// Main holds no geometry at rest; Blender's code gets it filled.
assert.equal(blender.mesh(ob(cube)).verts_num, 0, "Main's Mesh is empty at rest");

// Blender to Babylon: an operator's changes come back through the same mapping.
selection.replace([cube]);
const { status } = sync.run(() => blender.run('object.location_clear'), { meshes: [cube] });
assert.equal(status, OPERATOR_FINISHED);
assert.deepEqual(cube.position.asArray(), [0, 0, 0]);
assert.equal(blender.mesh(ob(cube)).verts_num, 0, 'the geometry is released after the run');
selection.replace([cube, other]);
cube.scaling = new Vector3(2, 1, 1);
sync.run(() => blender.run('object.transform_apply', { location: false, rotation: false, scale: true }), { meshes: [cube, other] });
assert.deepEqual(cube.scaling.asArray(), [1, 1, 1]);
assert.equal(JSON.parse(JSON.stringify(cube.metadata.wbCreation.mesh)).vert_positions.some((v) => Math.abs(v) === 2), true, 'the applied scale is in the geometry');
assert.deepEqual(sync.check(), []);

console.log('Scene sync: Babylon and Main stay equal');
