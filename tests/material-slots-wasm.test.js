// Material slots drawn as Blender draws them: an instanced object of several slots draws each slot's faces in its
// material, as its source does (a cube whose top is Red and the rest Blue, instanced twice), and faces in an empty slot
// take Blender's default surface, in the app and the exported page (cube Plain's top). The scene is
// tests/fixtures/instanced-slots.blend, written by tools/blender-reference/instanced-slots-fixture.py.
import assert from 'node:assert/strict';
import { NullEngine } from '@babylonjs/core';
import { exportModule } from '../src/io_scene_babylon/js-export.js';
import { openExample } from './open-example.js';
import { writePackage } from './export-package.js';

const { world, scene, sync } = openExample(new URL('./fixtures/instanced-slots.blend', import.meta.url));
sync.view();
const [cubes] = scene.meshes.filter((m) => m.name.startsWith('__instances'));
assert.equal(cubes.thinInstanceCount, 2);
assert.deepEqual(cubes.subMeshes.map((s) => [s.getMaterial()?.name, s.indexCount]), [['Blue', 30], ['Red', 6]], "each slot's faces in its material");

const slots = (mesh) => mesh.subMeshes.map((s) => { const m = s.getMaterial(); return [m?.getClassName(), m?.albedoColor?.asArray().map((c) => +c.toFixed(2)), m?.roughness]; });
const SURFACE = ['PBRMaterial', [0.8, 0.8, 0.8], 0.5];
assert.deepEqual(slots(scene.meshes.find((m) => m.name === 'Plain'))[1], SURFACE, "an empty slot's faces in Blender's default surface");
const blend = await (await import(writePackage(await exportModule(world, { live: true })).url)).load(new NullEngine());
assert.deepEqual(slots(blend.scene.meshes.find((m) => m.name === 'Plain'))[1], SURFACE, 'and in the page');
console.log("Material slots: an instanced object draws each slot in its material, an empty slot Blender's default surface");
