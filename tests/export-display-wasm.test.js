// An exported page displays as the app's rendered view through its .blend's view transform (Lava's AgX, kept through
// Node's view as a project keeps it): its materials and the world's clear color draw in scene linear and the camera's
// last post process displays them through Blender's transform, not left linear by Bylonder's own pipeline turning the
// scene's image processing off; a camera the page makes active takes it and the scene's other passes.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { FreeCamera, NullEngine, PassPostProcess, Vector3 } from '@babylonjs/core';
import { openExample } from './open-example.js';
import { writePackage } from './export-package.js';
import { exportModule } from '../src/io_scene_babylon/js-export.js';
import { idStruct } from '../src/python/bpy_rna.js';

const { world, sync } = openExample('lava');
sync.view();
assert.equal(idStruct(sync.blender.scene).view_settings.view_transform, 'AgX', "the .blend's view transform stays Main's");
const files = await exportModule(world);
assert.ok(JSON.parse(/const DISPLAY = (.*);/.exec(files['scene.js'])[1]).lattice, 'the page displays through AgX, not Standard');
const written = writePackage(files);
const blend = await (await import(written.url)).load(new NullEngine());
const { scene } = blend, posts = scene.activeCamera._postProcesses.filter(Boolean);
assert.equal(posts.at(-1)?.name, 'Display Transform', 'the camera ends in the display transform');
assert.ok(scene.imageProcessingConfiguration.applyByPostProcess, 'materials draw in scene linear');
// What the page draws over its camera belongs to the scene (bylonder/camera-effects.js): a pass added to it and the
// display transform move, in order, to a camera the page makes active (a game's own); the file's camera keeps neither.
const { cameraEffects, postProcessEffect } = await import(pathToFileURL(join(written.dir, 'bylonder/camera-effects.js')).href);
const fileCamera = scene.activeCamera, display = posts.at(-1);
const pass = cameraEffects(scene).add(postProcessEffect(new PassPostProcess('Pass', 1, null, undefined, scene.getEngine()), display)).post;
assert.deepEqual(fileCamera._postProcesses.filter(Boolean).map((p) => p.name).slice(-2), ['Pass', 'Display Transform'], 'a pass goes before the display');
scene.activeCamera = new FreeCamera('game', new Vector3(0, 1, -5), scene);
scene.render();
assert.deepEqual(scene.activeCamera._postProcesses.filter(Boolean), [pass, display], "a camera made active takes the scene's passes, in order");
assert.ok(!fileCamera._postProcesses.some((p) => p === pass || p === display), "the file's camera keeps none");
blend.dispose();
written.remove();
console.log("Export display: the .blend's view transform (AgX) displays the page in a post process, as the app does");
process.exit(0);
