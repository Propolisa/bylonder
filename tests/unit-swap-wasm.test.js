// Swapping units (docs/escaping-the-gpl.md): a package's units.json names each unit with its licence, files, uses and
// interface; the shipped Simple Deform is the oracle the worked example's own matches (unit-oracle.mjs); exported with
// every GPL unit replaced, the package ships no GPL file, its entities stay baked until units are registered, and the
// registered Simple Deform runs in place of modifiers.wasm.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { NullEngine } from '@babylonjs/core';
import { openExample } from './open-example.js';
import { exportModule } from '../src/io_scene_babylon/js-export.js';
import { gplFiles } from '../src/io_scene_babylon/runtime-files.js';
import { writePackage } from './export-package.js';

const { world, sync } = openExample('vertex-and-weight-paint');
sync.view();
await world.modifiers.settled?.();
const KOI = 'OB:Kohaku/modifier/Tail Swing', ANGLE = 'objects["Kohaku"].modifiers["Tail Swing"].angle';

const whole = await exportModule(world, { live: true });
const units = JSON.parse(whole['units.json']).units;
const deform = units['modifier:SIMPLE_DEFORM'];
assert.equal(deform.licence, 'GPL-3.0-or-later');
assert.deepEqual(deform.files, ['bylonder-modifiers/modifiers-worker.js', 'bylonder-modifiers/modifiers.wasm']);
assert.ok(deform.uses.some((use) => use.entity === KOI && use.properties.includes(ANGLE)), 'its uses name the koi and the controls they read');
assert.equal(deform.interface.inputs.angle, 'property');
assert.ok(Object.values(units).some((u) => u.kind === 'shader-node' && u.interface.params.length), 'shader nodes with their GLSL parameters');

// The oracle: the worked example against the shipped modifiers.wasm on the scene's own inputs.
const oracle = writePackage(whole);
const report = JSON.parse(execFileSync(process.execPath, [fileURLToPath(new URL('export-parity/unit-oracle.mjs', import.meta.url)), oracle.dir,
  fileURLToPath(new URL('../docs/units/simple-deform.js', import.meta.url))], { encoding: 'utf8' }).trim().split('\n').at(-1));
assert.deepEqual(report.failures, []);
assert.ok(report.checked >= 10, `${report.checked} input sets checked`);
oracle.remove();

// Every GPL unit replaced: no GPL file, and Simple Deform runs as the page registers it.
const free = await exportModule(world, { live: true, replace: ['modifier:*', 'node:*', 'block:area_specular', 'block:icons'] });
assert.deepEqual(gplFiles(free), []);
assert.match(free['bylonder-nodes/nodes.js'], /MIT OR Apache-2.0/);
assert.doesNotMatch(free['scene.js'], /Includes GPL code/);
const ir = JSON.parse(free['scene.ir.json']);
assert.ok(Object.values(ir.entities).every((e) => e.implementation !== 'modifiers'), 'no entity names modifiers.wasm');
const written = writePackage(free);
assert.ok(!existsSync(join(written.dir, 'bylonder-modifiers')));
const { register } = await import(pathToFileURL(join(written.dir, 'bylonder/units.js')).href);
register('modifier:SIMPLE_DEFORM', (await import('../docs/units/simple-deform.js')).default['modifier:SIMPLE_DEFORM']);
// The koi's Subdivision after it, replaced too, as a stand-in that passes the mesh on: without a unit it stays baked.
register('modifier:SUBSURF', { run: ({ mesh }) => ({ mesh }) });
const blend = await (await import(written.url)).load(new NullEngine());
const koi = blend.scene.getMeshById('Kohaku'), before = Array.from(koi.getVerticesData('position'));
blend.set(ANGLE, 1.2);
await blend.settled();
assert.notDeepEqual(Array.from(koi.getVerticesData('position')), before, 'the registered Simple Deform bends the koi');
blend.dispose();
written.remove();
console.log(`unit swap: ${Object.keys(units).length} units in units.json, Simple Deform matches its oracle at ${report.checked} input sets, a package of replaced units ships no GPL file`);
process.exit(0);
