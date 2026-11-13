// A rig's switch between looks in exported pages: drivers of objects' Disable in Renders that read a rig's custom
// property (Snow's Skin, between his plain and tattooed meshes) run in the page, which shows each mesh as Blender renders
// it as the property changes, both ways; a driver of Disable in Viewports, which switches the viewport's proxies, does not
// hide what renders.
import assert from 'node:assert/strict';
import { NullEngine } from '@babylonjs/core';
import { blendData, contextStruct } from '../src/python/bpy_rna.js';
import { setCustomProperty } from '../src/blenkernel/animation/anim-blender.js';
import { exportModule } from '../src/io_scene_babylon/js-export.js';
import { openExample } from './open-example.js';
import { writePackage } from './export-package.js';

const { world, sync } = openExample('rigged-character');
const data = blendData(), C = contextStruct(), rig = data.objects.get('Rig'), body = data.objects.get('Body');
setCustomProperty(sync.objectOf(world.objects.find((n) => n.name === 'Rig')), 'skin', 0);
// Its expression of the rig's `skin` on an object's flag.
const drive = (ob, path, expression) => {
  const driver = (ob.animation_data ?? ob.animation_data_create()).drivers.new(path, 0).driver;
  Object.assign(driver, { type: 'SCRIPTED', expression });
  const variable = Object.assign(driver.variables.new(), { name: 'skin', type: 'SINGLE_PROP' });
  Object.assign(variable.targets[0], { id: rig, data_path: '["skin"]' });
};
const tattooed = data.objects.new('Tattooed', body.data);
C.scene.collection.objects.link(tattooed);
drive(body, 'hide_render', 'skin != 0');
drive(tattooed, 'hide_render', 'skin != 1');
drive(tattooed, 'hide_viewport', 'not skin == 1');
sync.view();

const written = writePackage(await exportModule(world));
const blend = await (await import(written.url)).load(new NullEngine());
await blend.settled();
blend.playhead.pause();
const shown = (name) => { const node = blend.scene.getMeshByName(name); return node.isEnabled() && node.isVisible; };
const set = async (value) => {
  blend.set('objects["Rig"]["skin"]', value);
  for (let i = 0; i < 2; i++) { blend.scene.render(); await blend.settled(); }
  return [shown('Body'), shown('Tattooed')];
};
assert.deepEqual([shown('Body'), shown('Tattooed')], [true, false], 'the plain body renders at skin 0');
assert.deepEqual(await set(1), [false, true], 'skin 1 renders the tattooed one');
assert.deepEqual(await set(0), [true, false], 'and back');
blend.dispose();
written.remove();
console.log("Export visibility drivers: a rig's look switch shows each mesh as Blender renders it, both ways");
process.exit(0);
