// A camera looking straight up keeps its roll in its exported page (Spiral Stair's, turned 20 degrees about the tower):
// Euler angles there lose it, so the page parses the camera's quaternion.
import assert from 'node:assert/strict';
import { NullEngine } from '@babylonjs/core';
import { openExample } from './open-example.js';
import { writePackage } from './export-package.js';
import { exportModule } from '../src/io_scene_babylon/js-export.js';

const { world, sync, scene } = openExample('arrays');
sync.view();
const written = writePackage(await exportModule(world));
const blend = await (await import(written.url)).load(new NullEngine());
const app = scene.activeCamera, page = blend.scene.activeCamera;
const view = (camera) => camera.getViewMatrix(true).asArray();
view(app).forEach((value, i) => assert.ok(Math.abs(value - view(page)[i]) < 1e-4, `the page's view matrix is the app's (${i}: ${value} vs ${view(page)[i]})`));
blend.dispose();
written.remove();
console.log('Export: a camera looking straight up keeps its roll in the page');
process.exit(0);
