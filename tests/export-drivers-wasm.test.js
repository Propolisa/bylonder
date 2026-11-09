// Driver entities of the IR and the scheduler on the Steam Engine example (docs/features/drivers-and-graph-editor.md): its
// drivers read the flywheel's rotation; set by its Blender path in the exported page, it moves the crosshead, the
// connecting and piston rods and the governor as Main moves them, by the clean-room driver units (runtime/drivers/), at
// many angles. A driver that reads an object's transform channel runs too, and the scheduler stays under 200 lines.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NullEngine } from '@babylonjs/core';
import { openExample } from './open-example.js';
import { exportModule } from '../src/io_scene_babylon/js-export.js';
import { writePackage } from './export-package.js';
import { idStruct } from '../src/python/bpy_rna.js';
import { babylonMatrix } from '../src/blenkernel/main-view.js';

const { world, sync, node } = openExample('drivers-and-graph-editor');
sync.view();
// A driver of a transform channel: the steam cylinder rises with the flywheel's world Y rotation.
const cylinder = idStruct(sync.objectOf(node('Steam Cylinder')));
const fc = (cylinder.animation_data ?? cylinder.animation_data_create()).drivers.new('location', 2), variable = fc.driver.variables.new();
Object.assign(variable, { name: 'r', type: 'TRANSFORMS' });
Object.assign(variable.targets[0], { id: idStruct(sync.objectOf(node('Flywheel'))), transform_type: 'ROT_Y', transform_space: 'WORLD_SPACE' });
fc.driver.expression = '0.1 * r + 0.8';
sync.view();

const files = await exportModule(world);
const ir = JSON.parse(files['scene.ir.json']);
const drivers = Object.entries(ir.entities).filter(([, e]) => e.implementation === 'driver');
const driven = ['Crosshead', 'Connecting Rod', 'Piston Rod', 'Governor Arm', 'Governor Arm.001', 'Governor Spindle', 'Steam Cylinder'];
assert.deepEqual([...new Set(drivers.map(([, e]) => e.outputs.value.property.replace(/^objects\["(.*)"\].*$/, '$1')))].sort(), [...driven].sort(),
  'each driver is an entity writing what it drives');
assert.ok(drivers.every(([key, e]) => key === `${e.id}/driver/${/\.([^.]+)$/.exec(e.outputs.value.property)[1]}`), 'keyed by its ID and the path it drives');
const flywheel = 'objects["Flywheel"].rotation_euler[1]';
assert.equal(ir.properties[flywheel].suggested, true, 'what a driver reads is a suggested property');
assert.ok(ir.order.indexOf('OB:Flywheel/animation/rotation_euler[1]') < ir.order.indexOf(drivers[0][0]), "the flywheel's animation comes before the drivers reading it");

const written = writePackage(files);
const blend = await (await import(written.url)).load(new NullEngine());
const page = blend.scene;
const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-4);
const flywheelOb = idStruct(sync.objectOf(node('Flywheel')));
for (let i = 0; i < 40; i++) {
  const angle = -7 + i * 0.37;
  blend.set(flywheel, angle);
  await blend.settled();
  flywheelOb.rotation_euler[1] = angle;
  sync.view();
  for (const name of driven) {
    const main = babylonMatrix(sync.blender.transform(sync.objectOf(node(name))).matrix_world), drawn = page.getNodeById(name).computeWorldMatrix(true);
    assert.ok(near(Array.from(drawn.m), Array.from(main.m)), `${name} at flywheel ${angle.toFixed(2)}: ${Array.from(drawn.m).map((v) => v.toFixed(4))} drawn, Main ${Array.from(main.m).map((v) => v.toFixed(4))}`);
  }
}
blend.dispose();
written.remove();

const lines = readFileSync(new URL('../src/io_scene_babylon/runtime/scheduler.js', import.meta.url), 'utf8').split('\n').length;
assert.ok(lines < 200, `the scheduler is ${lines} lines`);
console.log(`Export drivers: ${drivers.length} drivers run in the page by the clean-room units as Main evaluates them, at 40 flywheel angles; the scheduler is ${lines} lines`);
