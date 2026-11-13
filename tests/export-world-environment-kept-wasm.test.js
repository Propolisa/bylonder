// A world of nodes lights an exported page through a texture the scene keeps: the bake swaps the filtered cube into it.
// Bound as the environment itself, the probe's cube had its GPU texture replaced by the filtering, and on WebGPU every
// material then drew with a destroyed texture (a black page). The scene is tests/fixtures/environment-light.blend.
import assert from 'node:assert/strict';
import { FreeCamera, NullEngine, RenderTargetTexture, Vector3 } from '@babylonjs/core';
import { exportModule } from '../src/io_scene_babylon/js-export.js';
import { openExample } from './open-example.js';
import { writePackage } from './export-package.js';

const { world, sync } = openExample(new URL('./fixtures/environment-light.blend', import.meta.url));
sync.view();
const written = writePackage(await exportModule(world));
const { scene } = await (await import(written.url)).load(new NullEngine());
scene.activeCamera ??= new FreeCamera('eye', Vector3.Zero(), scene);
const environment = scene.environmentTexture;
assert.ok(environment && !(environment instanceof RenderTargetTexture), "the scene's environment is not the probe the bake draws into");
for (let i = 0; i < 20; i++) {
  scene.render();
  await new Promise((r) => setTimeout(r, 10));
}
assert.equal(scene.environmentTexture, environment, 'the environment is the same texture after the bake');
written.remove();
console.log('World environment kept: the bake swaps the baked cube into the texture the scene keeps');
process.exit(0);
