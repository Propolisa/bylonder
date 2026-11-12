// Grease Pencil Use Lights: a layer lit (its Use Lights and its object's) takes the scene's world color as its ambient
// light, as Blender's engine gives it; an unlit layer draws its colors as they are. The export carries each layer's
// light and the page lights its strokes and fills with it.
import assert from 'node:assert/strict';
import { NullEngine } from '@babylonjs/core';
import { exportModule } from '../src/io_scene_babylon/js-export.js';
import { idStruct } from '../src/python/bpy_rna.js';
import { openExample } from './open-example.js';
import { writePackage } from './export-package.js';

const { world, scene, sync } = openExample('grease-pencil');
const ob = idStruct(scene.transformNodes.map((n) => sync.objectOf(n)).find((o) => o && idStruct(o).type === 'GREASEPENCIL'));
const layers = Array.from(ob.data.layers), unlit = layers[0].name;
ob.use_grease_pencil_lights = true;
layers.forEach((layer, i) => (layer.use_lights = i > 0));
const color = Array.from(idStruct(sync.blender.scene).world.color);
sync.view();

const near = (l, rgb) => l?.every((c, i) => Math.abs(c - rgb[i]) < 1e-6);
const lightOf = (m) => m.material?.pluginManager?.getPlugin('BlenderSceneLinearStroke')?.light ?? m.material?.metadata?.gpLight;
const appLights = scene.meshes.map(lightOf).filter(Boolean);
assert.ok(appLights.some((l) => near(l, color)) && appLights.some((l) => near(l, [1, 1, 1])), 'the app lights lit layers and leaves the unlit one white');

const files = await exportModule(world, { live: true }), ir = JSON.parse(files['scene.ir.json']);
const light = (name) => Object.entries(ir.entities).find(([key, e]) => e.type === 'grease_pencil:LAYER' && key.endsWith(`/${name}`))[1].inputs.light;
assert.equal(light(unlit), null, 'a layer without Use Lights is unlit');
for (const { name } of layers.slice(1)) assert.deepEqual(light(name), color, `${name}: lit by the world's color`);

const blend = await (await import(writePackage(files).url)).load(new NullEngine());
blend.playhead.pause();
blend.playhead.seek(1);
blend.scene.render();
await blend.settled();
const lights = (index) => (blend.scene.transformNodes.find((n) => n.id.endsWith(`/grease_pencil/${index}`))?.getChildMeshes(true) ?? [])
  .filter((m) => m.material).map(lightOf);
assert.ok(lights(1).length && lights(1).every((l) => near(l, color)), 'the page lights a lit layer');
assert.ok(lights(0).length && lights(0).every((l) => near(l, [1, 1, 1])), 'and leaves an unlit one white');
console.log('Grease Pencil: layers that use lights are lit by the world, in the app, the export and its page');
