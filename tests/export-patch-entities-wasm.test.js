// A patch of what a page computes (BlendScene.patch, runtime/scheduler.js replace): after a driver's expression changes in
// the app, the patch replaces that driver's entity, the scheduler runs it again and what reads it, and the patched page
// places the driven parts as the new export does, at every flywheel angle a page sets.
import assert from 'node:assert/strict';
import { NullEngine } from '@babylonjs/core';
import { idStruct } from '../src/python/bpy_rna.js';
import { exportPackage } from '../src/io_scene_babylon/js-export.js';
import { packageState, tablesPatch } from '../src/io_scene_babylon/scene-patch.js';
import { writePackage } from './export-package.js';
import { openExample } from './open-example.js';

const { world, sync, node } = openExample('drivers-and-graph-editor');
const cylinder = idStruct(sync.objectOf(node('Steam Cylinder')));
const fc = (cylinder.animation_data ?? cylinder.animation_data_create()).drivers.new('location', 2), variable = fc.driver.variables.new();
Object.assign(variable, { name: 'r', type: 'TRANSFORMS' });
Object.assign(variable.targets[0], { id: idStruct(sync.objectOf(node('Flywheel'))), transform_type: 'ROT_Y', transform_space: 'WORLD_SPACE' });
fc.driver.expression = '0.1 * r + 0.8';
sync.view();

const exported = async () => { const made = await exportPackage(world); return { made, state: packageState(made) }; };
const loaded = async ({ made }) => {
  const written = writePackage(made.files), blend = await (await import(written.url)).load(new NullEngine());
  await blend.settled();
  blend.playhead.pause();
  return { blend, remove: written.remove };
};
const first = await exported(), page = await loaded(first);

fc.driver.expression = '0.3 * r + 0.5';
sync.view();
const second = await exported(), patch = tablesPatch(first.state, second.state);
assert.ok(Object.keys(patch.tables.entities ?? {}).some((key) => key.startsWith('OB:Steam Cylinder/driver/')), `the patch replaces the driver: ${Object.keys(patch.tables).join(', ')}`);
assert.equal(await page.blend.patch({ ...patch, buffers: second.made.buffers }), page.blend, 'and applies to the open page');

const fresh = await loaded(second), flywheel = 'objects["Flywheel"].rotation_euler[1]';
const height = async (blend, angle) => {
  blend.set(flywheel, angle);
  await blend.settled();
  return +blend.scene.getNodeById('Steam Cylinder').position.y.toFixed(5);
};
for (const angle of [0, 0.5, 1.5, 3]) assert.equal(await height(page.blend, angle), await height(fresh.blend, angle), `the cylinder at ${angle} as the new export places it`);
page.remove();
fresh.remove();
console.log('Export patch entities: a changed driver reaches an open page as a patch, run again with what reads it');
process.exit(0);
