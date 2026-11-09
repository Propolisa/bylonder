// Dusk Lake (examples/grease-pencil) exports: evaluating its frames redraws the strokes' meshes, which stay out of
// the package.
import assert from 'node:assert/strict';
import { openExample } from './open-example.js';
import { exportModule } from '../src/io_scene_babylon/js-export.js';

const { world, sync } = openExample('grease-pencil');
sync.view();
const files = await exportModule(world, { live: true });
assert.ok(files['scene.ir.json'], 'the package is written');
console.log('Export: a Grease Pencil scene exports');
process.exit(0);
