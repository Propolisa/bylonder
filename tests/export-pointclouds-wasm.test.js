// Point clouds in the JavaScript export: each point cloud a render draws (here the Geometry Nodes planet's clouds) is an
// IR entity holding its points in scene.bin, and the page draws it as the app does: a sphere at each point, with the
// app's point cloud drawing (draw/pointcloud.js, GPL, in bylonder-pointclouds/), in its material, under its object.
import assert from 'node:assert/strict';
import { NullEngine } from '@babylonjs/core';
import { exportModule } from '../src/io_scene_babylon/js-export.js';
import { openExample } from './open-example.js';
import { packageFiles, writePackage } from './export-package.js';

const { world } = openExample('geometry-nodes');
const app = world.scene.meshes.find((m) => m.metadata?.pointcloud);
const files = await exportModule(world, {});
const entities = Object.entries(JSON.parse(files['scene.ir.json']).entities).filter(([, e]) => e.type === 'pointcloud:POINTCLOUD');
assert.deepEqual(entities.map(([key]) => key), ['OB:Planet/pointcloud/0'], "one entity for the planet's clouds");
const [[, entity]] = entities;
assert.equal(entity.inputs.material, app.material.id, 'drawn in its material');
const units = JSON.parse(files['units.json']).units['pointcloud:POINTCLOUD'];
assert.deepEqual([units.licence, units.files, units.swappable], ['GPL-3.0-or-later', ['bylonder-pointclouds/pointcloud.js'], undefined], 'a swappable GPL unit');
assert.ok(['bylonder-pointclouds/pointcloud.js', 'bylonder-pointclouds/LICENSE.md', 'bylonder/pointclouds.js'].every((path) => path in packageFiles(files)), "Blender's drawing ships as GPL beside the page runtime");

const written = writePackage(files);
const blend = await (await import(written.url)).load(new NullEngine());
await blend.settled();
const mesh = blend.scene.getMeshById(`${entity.outputs.geometry.draw}/pointcloud/0`);
assert.ok(mesh, 'the page draws the clouds');
assert.equal(mesh.forcedInstanceCount, app.forcedInstanceCount, 'a sphere at each point');
assert.equal(mesh.parent?.id, 'Planet', 'under its object, which it follows');
assert.equal(mesh.material?.name, app.material.name, 'in its material');
assert.ok(mesh.material.pluginManager.getPlugin('BlenderPointCloud'), "with the app's point cloud drawing");
written.remove();
console.log(`Export point clouds: ${mesh.forcedInstanceCount} points drawn as spheres with the app's point cloud drawing`);
process.exit(0);
