import assert from 'node:assert/strict';
import { NullEngine, Scene, MeshBuilder, FreeCamera, ArcRotateCamera, PointLight, PBRMaterial, StandardMaterial, Vector3, AppendSceneAsync, VertexBuffer } from '@babylonjs/core';
import { createModifierSystem } from '../src/modifiers/stack.js';
import { createAnimationModel } from '../src/blenkernel/animation/model.js';
import { registerObjects, bindProperties, registerStore } from '../src/blenkernel/animation/bindings.js';
import { createRenderSettings } from '../src/blenkernel/scene/render.js';
import { createSceneSettings } from '../src/blenkernel/scene/settings.js';
import { asObject } from '../src/runtime/object-transform.js';
import { serializeScene } from '../src/io_scene_babylon/babylon-export.js';
import { exportModule } from '../src/io_scene_babylon/js-export.js';
import { writePackage } from './export-package.js';
import { sceneMain } from './scene-main.js';
import { idStruct } from '../src/python/bpy_rna.js';

// A Default Cube with Subdivision Surface, a PBR material whose color is keyed, a point light and the scene camera,
// next to Bylonder's helpers: an overlay mesh, an editor camera and the cube's loose-edge line child.
const engine = new NullEngine(), scene = new Scene(engine);
const cube = MeshBuilder.CreateBox('Cube', { size: 2 }, scene);
cube.metadata = { wbId: 'cube', wbCreation: { operator: 'mesh.primitive_cube_add', options: {} }, author: 'kept' };
const paint = cube.material = Object.assign(new PBRMaterial('Material', scene), { metallic: 0 });
const camera = new FreeCamera('Camera', new Vector3(7.36, 4.96, -6.93), scene);
camera.setTarget(Vector3.Zero());
const light = new PointLight('Light', new Vector3(4, 6, 1), scene);
const grid = MeshBuilder.CreatePlane('__grid', {}, scene);
grid.doNotSerialize = true;
grid.material = new StandardMaterial('__gridMaterial', scene);
const editorCamera = new ArcRotateCamera('__editorCamera', 0, 1, 10, Vector3.Zero(), scene);
scene.activeCamera = editorCamera;
const wire = MeshBuilder.CreateLines('Cube loose edges', { points: [Vector3.Zero(), Vector3.One()] }, scene);
Object.assign(wire, { parent: cube, metadata: { drawOwner: cube } });

const animation = createAnimationModel();
const objects = Object.assign([cube, asObject(light), asObject(camera)], { scene });
const world = { scene, objects, animation };
world.sceneSettings = createSceneSettings(world, { cameras: { list: () => [camera], get: () => camera, set: () => {} } });
world.renderSettings = createRenderSettings(world);
world.modifiers = createModifierSystem(world, { notify: (message) => { throw Error(message); } });
// Blender's modifiers evaluate in Main.
sceneMain(world);
registerObjects(animation, objects);
const material = bindProperties(animation, paint, { id: 'material', properties: { albedoColor: {}, metallic: {} } });
// A project's SDK control (sdk.controls), a value of a store.
registerStore(animation, 'look', 'Look', { schema: { glow: {} }, values: { glow: 0.5 }, set() {} });
animation.time.configure({ frameStart: 1, frameEnd: 20 });
animation.insert([animation.ref('object:cube', 'position.x')], 1, 0);
animation.insert([animation.ref('object:cube', 'position.x')], 20, 3);
animation.insert([material.ref('albedoColor.g')], 1, 0);
animation.insert([material.ref('albedoColor.g')], 20, 1);
// The material's metallic keyed at 0 and driven by the frame, which overrides its F-curve: exported as Main evaluates it.
const metallic = material.ref('metallic'), owner = animation.ownerOf(metallic);
animation.insert([metallic], 1, 0);
animation.anim.addDriver(owner, animation.dataPath(metallic), -1, 0);
Object.assign(idStruct(owner).animation_data.drivers[0].driver, { type: 'SCRIPTED', expression: 'frame / 20' });
animation.seek(1);
world.modifiers.add(cube, 'SUBSURF', { levels: 2 });
assert.equal(cube.getTotalIndices(), 96 * 2 * 3, 'the cube draws its evaluated mesh');

// .babylon: the evaluated mesh with its material, the light and the scene camera, and none of the helpers.
const json = await serializeScene(world);
assert.deepEqual(json.meshes.map((m) => m.name), ['Cube']);
assert.deepEqual(json.cameras.map((c) => c.name), ['Camera']);
assert.equal(json.activeCameraID, 'Camera');
assert.deepEqual(json.lights.map((l) => l.name), ['Light']);
assert.deepEqual(json.materials.map((m) => m.name), ['Material']);
assert.deepEqual(json.meshes[0].metadata, { author: 'kept' }, "Bylonder's metadata stays out");
assert.equal(json.geometries.vertexData.length, 1);
assert.deepEqual(json.geometries.vertexData[0].indices.length, cube.getTotalIndices());
// Keyed with Blender's Auto Clamped handles: each animated component is its F-curve exactly, as Babylon's Hermite keys.
assert.deepEqual(json.animationGroups[0].targetedAnimations.map((t) => t.targetId + ' ' + t.animation.property).sort(), ['Cube material.albedoColor.g', 'Cube material.metallic', 'Cube position.x']);
assert.equal(json.animationGroups[0].targetedAnimations.find((t) => t.animation.property === 'position.x').animation.keys.length, 2, 'two keys, not a sample per frame');
assert.equal(scene.activeCamera, editorCamera, 'the scene is left as it was');
assert.equal(grid.doNotSerialize, true);
assert.equal(cube.metadata.wbId, 'cube');

// Reloaded by Babylon's own loader into a fresh scene: the same geometry, material and animation.
const positions = (mesh) => Array.from(mesh.getVerticesData(VertexBuffer.PositionKind));
const close = (a, b) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 1e-5);
async function check(loaded, label) {
  const mesh = loaded.getMeshByName('Cube');
  assert.ok(close(positions(mesh), positions(cube)), label + ': positions');
  assert.deepEqual(Array.from(mesh.getIndices()), Array.from(cube.getIndices()), label + ': indices');
  assert.equal(mesh.material.getClassName(), 'PBRMaterial', label + ': material');
  assert.equal(loaded.activeCamera.name, 'Camera', label + ': active camera');
  assert.equal(loaded.lights.length, 1, label + ': lights');
  const group = loaded.animationGroups[0];
  group.start(false); group.pause(); group.goToFrame(20);
  assert.ok(Math.abs(mesh.position.x - 3) < 1e-4, label + ': animated position');
  assert.ok(Math.abs(mesh.material.albedoColor.g - 1) < 1e-4, label + ': animated material');
  assert.ok(Math.abs(mesh.material.metallic - 1) < 1e-4, label + ': driven material');
}
const reloaded = new Scene(new NullEngine());
await AppendSceneAsync('data:' + JSON.stringify(json), reloaded);
await check(reloaded, '.babylon');

// .js: a module that builds the same scene; its import of @babylonjs/core resolves here to the installed package.
const files = await exportModule(world);
const source = files['scene.js'];
assert.match(source, /export async function createScene\(engine, canvas\)/);
assert.doesNotMatch(source, /__grid|__editorCamera|loose edges|wbCreation/);
assert.deepEqual(Object.keys(files).sort(), ['package.json', 'scene.bin', 'scene.d.ts', 'scene.js']);
const written = writePackage(files);
const module = await import(written.url);
await check(await module.createScene(new NullEngine(), null), '.js');
// load(): the same scene with its controls, among them the SDK control, a Scene custom property.
const blend = await module.load(new NullEngine());
await check(blend.scene, 'load');
const glow = blend.controls().find((c) => c.path.endsWith('["store:look glow"]'));
assert.ok(glow?.path.startsWith('scenes["') && glow.default === 0.5 && glow.suggested, `the SDK control: ${JSON.stringify(glow)}`);
blend.set('objects["Cube"].location[0]', 2);
assert.equal(blend.scene.getMeshByName('Cube').position.x, 2);
written.remove();
// For a host that compresses it, scene.bin is the arrays as they are.
const hosted = await exportModule(world, { hostCompression: true });
assert.ok(hosted['scene.bin'].length > files['scene.bin'].length, 'scene.bin uncompressed');
const writtenHosted = writePackage(hosted);
await check(await (await import(writtenHosted.url)).createScene(new NullEngine(), null), 'host compression');
writtenHosted.remove();
console.log('Export: .babylon and .js reload the evaluated mesh, material, light, camera and animation, without helpers');
