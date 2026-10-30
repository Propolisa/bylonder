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
// Objects of types drawn only as evaluated: a metaball as its evaluated mesh, a lattice where it is.
sync.run(() => blender.run('object.metaball_add', { type: 'BALL' }));
sync.run(() => blender.run('object.add', { type: 'LATTICE', location: [0, 3, 0] }));
sync.run(() => blender.run('surface.primitive_nurbs_surface_sphere_add', {}));
const ball = objects.find((node) => node.metadata?.wbType === 'META'), lattice = objects.find((node) => node.metadata?.wbType === 'LATTICE');
assert(ball?.getTotalVertices() > 100, `the metaball's evaluated mesh: ${ball?.getTotalVertices()}`);
assert(Math.abs(lattice.getWorldMatrix().getTranslation().z - 3) < 1e-5, 'the lattice where Blender has it');
const surface = objects.find((node) => node.metadata?.wbType === 'SURFACE');
assert(surface?.getTotalVertices() > 100, `the surface's evaluated mesh: ${surface?.getTotalVertices()}`);
assert.deepEqual(sync.check(), []);
// Instancing on vertices: a plane draws its child at each of its vertices, as Blender's draw engines draw the instances.
sync.run(() => blender.run('mesh.primitive_plane_add', { size: 4, location: [0, 0, 10] }));
blendData().objects.get('Dice').parent = blendData().objects.get('Plane');
blendData().objects.get('Plane').instance_type = 'VERTS';
sync.view();
const carrier = scene.meshes.find((mesh) => mesh.name.startsWith('__instances'));
assert.equal(carrier?.thinInstanceCount, 4, 'one instance at each vertex');
assert(carrier.thinInstanceGetWorldMatrices().every((m) => Math.abs(m.getTranslation().y - 10) < 1e-4), "at the plane's height");
blendData().objects.get('Plane').instance_type = 'NONE';
sync.view();
assert(!scene.meshes.some((mesh) => mesh.name.startsWith('__instances')), 'no instances once it instances nothing');
// A collection instance: an empty draws the collection's objects where it is.
const set = blendData().collections.new('Set');
set.objects.link(blendData().objects.get('Dice'));
const holder = blendData().objects.new('Holder', null);
blendData().scenes.get('Scene').collection.objects.link(holder);
Object.assign(holder, { instance_type: 'COLLECTION', instance_collection: set, location: [5, 0, 0] });
sync.view();
const instances = scene.meshes.filter((mesh) => mesh.name.startsWith('__instances'));
assert.deepEqual(instances.map((mesh) => mesh.thinInstanceCount), [1], 'one instance of the dice');
const at = instances[0].thinInstanceGetWorldMatrices()[0].getTranslation();
assert(Math.abs(at.x - 5) < 1e-3, `where the empty is: ${at}`);
console.log("Frame change: Main evaluated by Blender's animation system, its values drawn by kind; a material derived from Main; a light and a camera where their constraints put them; faces drawn with their slots' materials; a light's new type; a metaball, a NURBS surface and a lattice; instancing on vertices and collection instances");
