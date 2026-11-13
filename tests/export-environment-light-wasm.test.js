// An exported page's materials are lit by its world's environment from their first build: the world's environment
// exists before the other materials are made, as Babylon's PBR block writes the environment's light only for an
// environment present at its build (a material built before it stayed black in shade, A5's rocks and ground). The
// scene is tests/fixtures/environment-light.blend, written by tools/blender-reference/environment-light-fixture.py.
import assert from 'node:assert/strict';
import { NullEngine } from '@babylonjs/core';
import { exportModule } from '../src/io_scene_babylon/js-export.js';
import { openExample } from './open-example.js';
import { writePackage } from './export-package.js';

const { world, sync } = openExample(new URL('./fixtures/environment-light.blend', import.meta.url));
sync.view();
const written = writePackage(await exportModule(world));
const { scene } = await (await import(written.url)).load(new NullEngine());
const ground = scene.getMaterialByName('Ground');
assert.ok(scene.environmentTexture && ground?.getBlockByPredicate((b) => b.getClassName() === 'ReflectionBlock'), "the world's environment lights an image-textured material");
// Built as the first frame builds it, before the world has baked.
ground.build();
for (let i = 0; i < 200 && !ground._fragmentCompilationState?._builtCompilationString; i++) await new Promise((r) => setTimeout(r, 10));
assert.match(ground._fragmentCompilationState._builtCompilationString, /reflectionOut/, "its first build takes the environment's light");
written.remove();
console.log("Environment light: an exported page's materials take the world's environment from their first build");
process.exit(0);
