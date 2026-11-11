// File > Export > JavaScript's Bundle (io_scene_babylon/bundle.js) of a scene with hair: the curves blocks' GLSL,
// Blender's code, imports the blocks, Blender's code too, beside it, so both stay files of their own.
import assert from 'node:assert/strict';
import { openExample } from './open-example.js';
import { bundledFiles } from './export-package.js';
import { exportModule } from '../src/io_scene_babylon/js-export.js';
import { CURVES_GLSL_FILE } from '../src/io_scene_babylon/curves-export.js';

const { world, sync } = openExample('hair-dynamics');
sync.view();
const bundled = await bundledFiles(await exportModule(world, { bundle: true, target: 'WEBGL2' }));
assert.match(bundled[CURVES_GLSL_FILE], /from\s*["']\.\/curves\.js["']/, "the curves GLSL imports the blocks beside it");
assert.ok(bundled['bylonder-curves/curves.js'], 'which are in the package');
console.log("Export: a scene with hair bundles, Blender's curves code in files of its own");
process.exit(0);
