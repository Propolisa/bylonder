// Exports a shot file (a .blend with its own rig and animation, made self-contained) as a page package playing its
// timeline, as File > Export > JavaScript does: the rig on the native runtime where its deform needs it, only the bones
// that deform kept.
//   usage: node tools/docs/export-shot.mjs <shot.blend> <out folder>
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { openExample } from '../../tests/open-example.js';
import { packageFiles } from '../../tests/export-package.js';
import { exportModule } from '../../src/io_scene_babylon/js-export.js';

const [blend, out] = process.argv.slice(2).map((p) => resolve(p));
const { world, sync } = openExample(blend);
sync.view();
const files = packageFiles(await exportModule(world, { target: 'WEBGL2', controlPanel: false, devTools: 'CDN', runtimes: { ARMATURE: { runtime: 'MAPPED', instances: {} } } }));
rmSync(out, { recursive: true, force: true });
for (const [path, data] of Object.entries(files)) {
  if (path.endsWith('.d.ts') || path === 'package.json') continue;
  mkdirSync(dirname(join(out, path)), { recursive: true });
  writeFileSync(join(out, path), data);
}
console.log(`exported ${Object.keys(files).length} files to ${out}`);
process.exit(0);
