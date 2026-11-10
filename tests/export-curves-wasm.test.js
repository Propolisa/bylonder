// Curves in the JavaScript export: each set of curves a render draws (here a Curves object's, Hair Dynamics' Tentacles)
// is an IR entity holding Main's curves draw in scene.bin, and the page draws it as the app does: the same buffers and
// Hair shape on a mesh of Blender's batch vertices, in the exported material with the app's curves blocks. Curves Off in
// File > Export's Branches leaves them out.
import assert from 'node:assert/strict';
import { NullEngine } from '@babylonjs/core';
import { exportModule } from '../src/io_scene_babylon/js-export.js';
import { openExample } from './open-example.js';
import { writePackage } from './export-package.js';
import { sceneBranches } from '../src/io_scene_babylon/branches.js';

const { world, sync } = openExample('hair-dynamics');
sync.view();
const files = await exportModule(world, { live: true });
const ir = JSON.parse(files['scene.ir.json']);
const entities = Object.entries(ir.entities).filter(([, e]) => e.type === 'curves:CURVES');
assert.deepEqual(entities.map(([key]) => key), ['OB:Tentacles/curves/curves'], 'one entity for the Curves object');
const [[, entity]] = entities;
assert.equal(entity.inputs.material, 'Tentacle', 'drawn in its material');
assert.ok(files['bylonder-curves/glsl.js']?.includes('GPL-3.0-or-later') && files['scene.js'].includes("import './bylonder-curves/glsl.js'"), "Blender's curves GLSL ships as GPL");

const [record] = sync.blender.curves().filter((r) => r.render);
const app = { posRad: Float32Array.from(record.posRad), indirection: Int32Array.from(record.indirection), faces: record.faces };

const written = writePackage(files);
const blend = await (await import(written.url)).load(new NullEngine());
const page = blend.scene;
await blend.settled();
const mesh = page.getMeshById(`${entity.outputs.geometry.draw}/curves/curves`);
assert.ok(mesh, 'the page draws the curves');
assert.equal(mesh.material?.name, 'Tentacle', 'in the exported material');
assert.ok(mesh.material.attachedBlocks.some((b) => b.getClassName() === 'CurvesGeometryBlock'), "with the app's curves blocks");
const { data, faces } = mesh.metadata.curves;
assert.equal(faces, app.faces, "the scene's Hair shape");
assert.equal(data.segments, app.indirection.length, "Blender's drawn segments");
assert.deepEqual(data.pos_rad.getInternalTexture()._bufferView.subarray(0, app.posRad.length), app.posRad, "Main's points");
blend.dispose();
written.remove();
assert.ok(sceneBranches(world).curves, 'Branches lists the curves');
const off = await exportModule(world, { live: true, branches: { curves: { state: 'OFF', instances: {} } } });
assert.ok(!Object.values(JSON.parse(off['scene.ir.json']).entities).some((e) => e.type === 'curves:CURVES') && !off['bylonder-curves/glsl.js'], 'Off ships no curves');
console.log(`Export curves: ${record.length.length} curves of ${app.posRad.length / 4} points drawn with the app's curves blocks`);
process.exit(0);
