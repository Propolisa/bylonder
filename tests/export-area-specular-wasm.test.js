// Lights' specular in an exported page is EEVEE's, as the app's PBR materials have it (Steam Engine's brass under its
// area Key Light): the page ships Blender's light specular (blenkernel/light/area-specular.js, GPL) beside its notice.
import assert from 'node:assert/strict';
import { NullEngine } from '@babylonjs/core';
import { openExample } from './open-example.js';
import { writePackage } from './export-package.js';
import { exportModule } from '../src/io_scene_babylon/js-export.js';
import { AREA_SPECULAR, gplFiles } from '../src/io_scene_babylon/runtime-files.js';

const { world, sync, scene } = openExample('drivers-and-graph-editor');
sync.view();
const files = await exportModule(world);
assert.ok(gplFiles(files).some(([path]) => path === AREA_SPECULAR), 'the package ships the light specular');
assert.ok(gplFiles(files).some(([path]) => path === 'bylonder-area-specular/LICENSE.md'), 'beside its notice');
const written = writePackage(files);
const blend = await (await import(written.url)).load(new NullEngine());
const plugins = (material) => material.pluginManager?._plugins.map((p) => p.name) ?? [];
assert.ok(plugins(scene.getMaterialByName('Brass')).includes('BlenderAreaSpecular'), 'the app weighs it as EEVEE does');
assert.ok(plugins(blend.scene.getMaterialByName('Brass')).includes('BlenderAreaSpecular'), 'the page does too');
blend.dispose();
written.remove();
console.log("Export: lights' specular in the page is EEVEE's, as in the app");
process.exit(0);
