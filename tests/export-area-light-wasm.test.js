// An area light lights its exported page as in the app (Steam Engine's Key Light): Babylon's parser, setting its radius,
// scales a RectAreaLight's intensity by 0; the page parses it as Bylonder's area light (runtime/area-light.js).
import assert from 'node:assert/strict';
import { NullEngine } from '@babylonjs/core';
import { openExample } from './open-example.js';
import { writePackage } from './export-package.js';
import { exportModule } from '../src/io_scene_babylon/js-export.js';

const { world, sync, scene } = openExample('drivers-and-graph-editor');
sync.view();
const written = writePackage(await exportModule(world));
const blend = await (await import(written.url)).load(new NullEngine());
const app = scene.getLightByName('Key Light'), page = blend.scene.getLightByName('Key Light');
assert.ok(app.getScaledIntensity() > 0, 'the app lights with it');
assert.equal(page.getScaledIntensity(), app.getScaledIntensity(), "the page's area light shines as the app's");
blend.dispose();
written.remove();
console.log('Export: an area light lights the page as in the app');
process.exit(0);
