// An export's scene.js asks for its own scene.bin, IR and images by their version (their content's hash), so a browser
// or server cache holding another export's files never pairs them with it (before, a re-export into a cached folder
// failed with "Invalid typed array length"); the same scene writes the same bytes and version, and a change to the
// scene changes it.
import assert from 'node:assert/strict';
import { NullEngine } from '@babylonjs/core';
import { blendData } from '../src/python/bpy_rna.js';
import { exportModule } from '../src/io_scene_babylon/js-export.js';
import { openExample } from './open-example.js';
import { writePackage } from './export-package.js';

const { world, sync } = openExample('framed-print');
const versionOf = (files) => [...String(files['scene.js']).matchAll(/'scene\.(bin|ir\.json)\?v=([^']+)'/g)].map((m) => m[2]);
const first = await exportModule(world);
const [bin, ir] = versionOf(first);
assert.ok(bin && bin === ir, 'scene.js names one version for scene.bin and its IR');
assert.deepEqual(versionOf(await exportModule(world)), [bin, ir], 'the same scene exports the same version');
const images = Object.keys(first).filter((path) => path.startsWith('images/'));
assert.ok(images.length, 'the scene has image files');
for (const path of images) assert.match(String(first['scene.js']), new RegExp(String.raw`${path.replace('.', '[.]')}\?v=\d+\.\d+`), `${path} is named with its version`);
[...blendData().objects].find((ob) => ob.type === 'MESH').location = [0, 0, 1];
sync.view();
assert.notEqual(versionOf(await exportModule(world))[0], bin, 'a changed scene exports another');

const written = writePackage(first);
const blend = await (await import(written.url)).load(new NullEngine());
assert.ok(blend.scene.meshes.length, 'the package loads by those versioned names');
blend.dispose();
written.remove();
console.log('Export file versions: scene.js asks for its own scene.bin and IR by their content\'s version');
process.exit(0);
