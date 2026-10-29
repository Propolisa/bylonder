// Bylonder's RNA over a NullEngine scene, as the scene sync reads it (makesrna/rna-bylonder.js): a text object's and a
// curve's data, a material's Principled BSDF, and light and camera data read and write through in Blender's units.
import assert from 'node:assert/strict';
import { NullEngine, Scene, Mesh, MeshBuilder, TransformNode, Vector3, PointLight, SpotLight, DirectionalLight, FreeCamera } from '@babylonjs/core';
import { createAnimationModel } from '../src/blenkernel/animation/model.js';
import { createSceneSettings } from '../src/blenkernel/scene/settings.js';
import { createRenderSettings } from '../src/blenkernel/scene/render.js';
import { createWorlds } from '../src/blenkernel/scene/world.js';
import { createCollections } from '../src/blenkernel/scene/collections.js';
import { createMaterialLibrary } from '../src/blenkernel/material/library.js';
import { createModifierSystem } from '../src/modifiers/stack.js';
import { createSelection } from '../src/editors/object/selection.js';
import { createRNA } from '../src/makesrna/rna-bylonder.js';
import { loadRNAUI } from '../src/makesrna/rna.js';
import { CurveObject } from '../src/blenkernel/curve/curve.js';
import { asObject } from '../src/runtime/object-transform.js';

await loadRNAUI();

const engine = new NullEngine(), scene = new Scene(engine);
const cube = MeshBuilder.CreateBox('Cube', { size: 2 }, scene), empty = new TransformNode('Empty', scene);
const point = new PointLight('Light', new Vector3(4, 6, 1), scene), spot = new SpotLight('Spot', Vector3.Zero(), new Vector3(0, -1, 0), Math.PI / 4, 2, scene);
const sun = new DirectionalLight('Sun', new Vector3(0, -1, 0), scene), camera = new FreeCamera('Camera', new Vector3(7.3589, 4.9583, -6.9258), scene);
// Blender's default camera, as the Default Cube example builds it.
camera.rotation = new Vector3((90 - 63.559) * Math.PI / 180, -46.692 * Math.PI / 180, 0);
[point, spot, sun, camera].forEach(asObject);
// A text object and a curve, with Curve data as Blender makes it (blenkernel/curve/curve.js).
const text = new Mesh('Text', scene), curve = new Mesh('Curve', scene);
const curveData = (type, settings) => { const object = new CurveObject(type); object.settings = settings; const data = object.data; object.free(); return data; };
const objects = [cube, empty, point, spot, sun, camera, text, curve];
objects.forEach((ob, i) => { ob.metadata = { wbId: 'ob' + i }; });
text.metadata.wbCreation = { curve: curveData('FONT', { align_x: 'CENTER', extrude: 0.1 }) };
curve.metadata.wbCreation = { curve: curveData('CURVE', {}) };
objects.scene = scene;
const world = { scene, objects, animation: createAnimationModel() };
world.sceneSettings = createSceneSettings(world);
world.renderSettings = createRenderSettings(world);
world.worlds = createWorlds(world);
world.collections = createCollections(world);
world.materials = createMaterialLibrary(world);
world.modifiers = createModifierSystem(world, { notify: (message) => { throw Error(message); } });
const selection = createSelection(scene, objects);
const updates = [];
const r = createRNA({ world, selection, update: (struct, name) => updates.push(`${struct}.${name}`) });

const pointer = (node) => r.pointer('Object', node);

// A text object's data is Blender's Font, a curve's Blender's Curve.
assert.equal(pointer(text).data.align_x, 'CENTER');
assert.equal(pointer(text).data.extrude, Math.fround(0.1));
assert.equal(pointer(curve).type, 'CURVE');
// A material is a Principled BSDF over the Babylon material's inputs.
world.materials.newMaterial(cube);
const principled = pointer(cube).active_material.node_tree.get_output_node('EEVEE').inputs.get('Surface').links[0].from_node;
assert.equal(principled.name, 'Principled BSDF');
principled.inputs.get('Roughness').default_value = 0.25;
assert.equal(world.materials.activeMaterial(cube).roughness, 0.25);

// Light and camera data read and write through in Blender's units.
const light = pointer(point).data;
assert.equal(light.type, 'POINT');
// A Babylon light's power is Blender's as Blender's glTF exporter converts it (Unitless: W / 4π candela).
assert.ok(Math.abs(light.energy - 4 * Math.PI) < 1e-9);
light.energy = 500;
assert.ok(Math.abs(point.intensity - 500 / (4 * Math.PI)) < 1e-9);
// A light Blender's code made keeps all of Blender's settings; its Babylon light is derived from them.
const { makeBlenderLight, lightLosses } = await import('../src/blenkernel/light/light-home.js');
const lamp = new PointLight('Lamp', Vector3.Zero(), scene);
makeBlenderLight(lamp, 'POINT', { energy: 1000, exposure: 1, use_temperature: true });
const lampData = r.pointer('PointLight', lamp);
assert.equal(lampData.energy, 1000);
assert.equal(lampData.exposure, 1);
assert.ok(Math.abs(lamp.intensity - 2000 / (4 * Math.PI)) < 1e-9, 'exposure doubles it');
lampData.energy = 400;
assert.ok(Math.abs(lamp.intensity - 800 / (4 * Math.PI)) < 1e-9);
assert.deepEqual(lightLosses(lamp), ['"' + lamp.name + '": its color temperature has no Babylon equivalent']);
const cameraObject = pointer(camera);
cameraObject.data.lens = 50;
const degrees = (radians) => [...radians].map((r) => Math.round(r * 180 / Math.PI * 1000) / 1000 + 0);
assert.deepEqual(degrees(cameraObject.rotation_euler), [63.559, 0, 46.692], "a camera's rotation is Blender's");
assert.deepEqual([...cameraObject.location].map((v) => Math.round(v * 1e4) / 1e4), [7.3589, -6.9258, 4.9583]);
cameraObject.rotation_euler = [Math.PI / 2, 0, 0];
assert.deepEqual(degrees(cameraObject.rotation_euler), [90, 0, 0], 'and writes back');
assert.ok(Vector3.TransformNormal(new Vector3(0, 0, 1), camera.getWorldMatrix()).subtract(new Vector3(0, 0, 1)).length() < 1e-6, 'looking along Blender +Y, Babylon +Z');
assert.ok(Math.abs(cameraObject.data.lens - 50) < 1e-9);
assert.ok(updates.includes('PointLight.energy') && updates.includes('Camera.lens'));

world.modifiers.dispose();
scene.dispose();
engine.dispose();
console.log('Properties: text, curve, material, light and camera data read and write through');
