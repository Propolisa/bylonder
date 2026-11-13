// A light Blender's render leaves out by its own Disable in Renders lights nothing in the exported page, as an object
// so disabled draws nothing there: the page turns the light off, where it used to hide it as if it were a mesh. The
// scene is tests/fixtures/render-disabled-light.blend, written by tools/blender-reference/render-disabled-light-fixture.py.
import assert from 'node:assert/strict';
import { NullEngine } from '@babylonjs/core';
import { exportModule } from '../src/io_scene_babylon/js-export.js';
import { openExample } from './open-example.js';
import { writePackage } from './export-package.js';

const { world, sync } = openExample(new URL('./fixtures/render-disabled-light.blend', import.meta.url));
sync.view();
const written = writePackage(await exportModule(world));
const { scene } = await (await import(written.url)).load(new NullEngine());
const enabled = Object.fromEntries(scene.lights.map((light) => [light.name, light.isEnabled()]));
assert.deepEqual(enabled, { Kept: true, Off: false }, 'the light disabled in renders is off, the other on');
written.remove();
console.log('Render-disabled light: a light disabled in renders is off in the exported page');
process.exit(0);
