// A frame change (main-sync.js frameChanged): Blender's animation system evaluates Main for the frame (view-api.cc
// view_frame_set) and the view draws the evaluated values by kind: an object's transform, a light's data. (Material
// paths wait for the module's RNA to resolve them.)
import assert from 'node:assert/strict';
import { NullEngine, Scene, Vector3, PointLight, PBRMaterial, Color3, FreeCamera } from '@babylonjs/core';
import { createMaterialLibrary } from '../src/blenkernel/material/library.js';
import { buildMesh } from '../src/editors/object/mesh-catalog.js';
import { primitive_add } from '../src/editors/mesh/editmesh-add.js';
import { mesh_serialize } from '../src/blenkernel/mesh/mesh.js';
import { asObject } from '../src/runtime/object-transform.js';
import { BlenderAnimation } from '../src/blenkernel/animation/anim-blender.js';
import { sceneMain } from './scene-main.js';
import { shaderTree } from '../src/blenkernel/main-sync.js';
import { createRNA } from '../src/makesrna/rna-bylonder.js';
import { createAnimationModel } from '../src/blenkernel/animation/model.js';
import { blendData, setContextPointer } from '../src/python/bpy_rna.js';

const scene = new Scene(new NullEngine()), objects = [];
objects.scene = scene;
const cube = buildMesh(scene, 'Cube', { operator: 'mesh.primitive_cube_add', options: {} });
cube.metadata = { wbId: 'cube', wbCreation: { operator: 'mesh.primitive_cube_add', options: {} } };
cube.material = Object.assign(new PBRMaterial('Paint', scene), { albedoColor: new Color3(0.8, 0.8, 0.8), metallic: 0, roughness: 0.5 });
const lamp = asObject(new PointLight('Lamp', new Vector3(0, 4, 0), scene));
lamp.metadata = { wbId: 'lamp' };
objects.push(cube, lamp);
const world = { scene, objects, animation: createAnimationModel() };
world.materials = createMaterialLibrary(world);
const sync = sceneMain(world);
sync.flush();
const { blender } = sync, anim = new BlenderAnimation(blender);
const keys = (id, path, index, values) => {
  const fcurve = anim.fcurve(id, path, index);
  for (const [frame, value] of values) anim.insert(fcurve, frame, value);
};
keys(sync.objectOf(cube), 'location', 0, [[1, 0], [11, 4]]);
keys(blender.data(sync.objectOf(lamp)), 'energy', 0, [[1, 10], [11, 30]]);

sync.frameChanged(6);
assert(Math.abs(cube.position.x - 2) < 1e-4, `the cube's location at frame 6: ${cube.position.x}`);
const energy = blender.data(sync.objectOf(lamp));
assert(lamp.intensity > 0 && Math.abs(lamp.intensity * 4 * Math.PI - 20) < 1e-3, `the light's energy at frame 6 is 20 W: ${lamp.intensity * 4 * Math.PI} (${energy})`);
sync.frameChanged(11);
assert(Math.abs(cube.position.x - 4) < 1e-4);
assert.deepEqual(sync.check(), []);

// A material's Principled BSDF in Main, as Blender's Properties editor edits it, is the Babylon material's: the view
// derives its base color.
const tree = shaderTree(createRNA({ world }).pointer('Material', cube.material).node_tree);
tree.nodes.find((node) => node.idname === 'ShaderNodeBsdfPrincipled').inputs.find((input) => input.identifier === 'Base Color').value = [0.1, 0.6, 0.2, 1];
blender.setNodeTree(sync.materialOf(cube.material), tree);
sync.view();
assert(Math.abs(cube.material.albedoColor.g - 0.6) < 1e-4, `the base color Main holds: ${cube.material.albedoColor.asArray()}`);
assert.deepEqual(sync.check(), []);

// A constraint Blender evaluates: the light copies the animated cube's location, drawn where the depsgraph puts it.
setContextPointer(blender.C);
const copy = blendData().objects.get(lamp.name).constraints.new('COPY_LOCATION');
copy.target = blendData().objects.get(cube.name);
sync.view();
sync.frameChanged(6);
lamp.computeTransformedInformation();
assert(Vector3.Distance(lamp.transformedPosition, cube.getAbsolutePosition()) < 1e-4, `the light at the cube: ${lamp.transformedPosition}`);
assert.equal(lamp.position.y, 4, "its own location is still Main's");
// A camera tracking the cube (Track To) looks at it.
const camera = asObject(new FreeCamera('Camera', new Vector3(0, 0, -10), scene));
camera.metadata = { wbId: 'camera' };
objects.push(camera);
sync.flush();
blendData().objects.get('Camera').constraints.new('TRACK_TO').target = blendData().objects.get(cube.name);
sync.view();
const looking = Vector3.TransformNormal(new Vector3(0, 0, 1), camera.getViewMatrix(true).clone().invert()).normalize();
assert(Vector3.Distance(looking, cube.getAbsolutePosition().subtract(camera.position).normalize()) < 1e-3, `the camera looks at the cube: ${looking}`);
// Faces of two material slots draw as one submesh per slot, each with its slot's material.
const twoTone = primitive_add('mesh.primitive_cube_add');
twoTone.attributes.set('material_index', { domain: 'FACE', type: 'INT', data: Int32Array.from([0, 1, 0, 1, 0, 1]) });
const recipe = { mesh: mesh_serialize(twoTone) }, dice = buildMesh(scene, 'Dice', recipe);
dice.metadata = { wbId: 'dice', wbCreation: recipe };
objects.push(dice);
world.materials.assign(dice, 0, cube.material);
world.materials.assign(dice, 1, Object.assign(new PBRMaterial('Ink', scene), { albedoColor: new Color3(0, 0, 0) }));
world.materials.sync();
sync.flush();
assert.deepEqual(dice.subMeshes.map((s) => [s.materialIndex, s.indexCount]), [[0, 18], [1, 18]], 'a submesh per slot');
assert.deepEqual(dice.material.subMaterials.map((m) => m.name), ['Paint', 'Ink']);
// A light's Type that Blender changes is a Babylon light of that type in its place.
blendData().objects.get(lamp.name).data.type = 'SPOT';
sync.view();
const retyped = objects.find((node) => node.metadata?.wbId === 'lamp');
assert.equal(retyped.getClassName(), 'SpotLight');
assert(lamp.isDisposed() && !objects.includes(lamp), 'the point light it was is gone');
assert.deepEqual(sync.check(), []);
console.log("Frame change: Main evaluated by Blender's animation system, its values drawn by kind; a material derived from Main; a light and a camera where their constraints put them; faces drawn with their slots' materials; a light's new type");
