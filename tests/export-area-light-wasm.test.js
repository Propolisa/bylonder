// An area light lights its exported page as in the app (Steam Engine's Key Light): Babylon's parser, setting its radius,
// scales a RectAreaLight's intensity by 0; the page parses it as Bylonder's area light (runtime/area-light.js). The
// package carries Babylon's LTC table the light reads, as the app serves it, so the page needs no CDN.
import assert from 'node:assert/strict';
import { NullEngine } from '@babylonjs/core';
import { openExample } from './open-example.js';
import { writePackage } from './export-package.js';
import { exportModule } from '../src/io_scene_babylon/js-export.js';
import { appFiles, AREA_LIGHTS_LTC } from '../src/io_scene_babylon/runtime-files.js';

const { world, sync, scene } = openExample('drivers-and-graph-editor');
sync.view();
const files = await exportModule(world);
assert.ok(appFiles(files).some(([path]) => path === AREA_LIGHTS_LTC), 'the package ships the LTC table');
assert.match(files['scene.js'], /Tools\.AssetBaseUrl \|\|= new URL\('babylon-assets', ROOT\)/, 'and points Babylon at it');
const written = writePackage(files);
const blend = await (await import(written.url)).load(new NullEngine());
const app = scene.getLightByName('Key Light'), page = blend.scene.getLightByName('Key Light');
assert.ok(app.getScaledIntensity() > 0, 'the app lights with it');
assert.equal(page.getScaledIntensity(), app.getScaledIntensity(), "the page's area light shines as the app's");
blend.dispose();
written.remove();
console.log('Export: an area light lights the page as in the app');
process.exit(0);
