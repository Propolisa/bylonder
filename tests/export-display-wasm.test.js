// An exported page displays as the app's rendered view on the Standard view transform (Lava): its materials and the
// world's clear color draw in scene linear and the camera's last post process encodes them to sRGB, not left linear by
// Bylonder's own pipeline turning the scene's image processing off.
import assert from 'node:assert/strict';
import { NullEngine } from '@babylonjs/core';
import { openExample } from './open-example.js';
import { writePackage } from './export-package.js';
import { exportModule } from '../src/io_scene_babylon/js-export.js';
import { idStruct } from '../src/python/bpy_rna.js';

const { world, sync } = openExample('lava');
sync.view();
assert.equal(idStruct(sync.blender.scene).view_settings.view_transform, 'Standard');
const written = writePackage(await exportModule(world));
const blend = await (await import(written.url)).load(new NullEngine());
const { scene } = blend, posts = scene.activeCamera._postProcesses.filter(Boolean);
assert.equal(posts.at(-1)?.name, 'Display Transform', 'the camera ends in the display transform');
assert.ok(scene.imageProcessingConfiguration.applyByPostProcess, 'materials draw in scene linear');
blend.dispose();
written.remove();
console.log('Export display: a Standard view transform encodes to sRGB in a post process, as the app does');
process.exit(0);
