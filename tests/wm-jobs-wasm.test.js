// Window-manager jobs on threads of their own, as in desktop Blender (wasm/platform.cc): drawing the Add Modifier menu
// starts the job that reads the asset list of its catalogs (Blender's Essentials library, files the job reads through
// the page's file system, port/thread-files.js) and returns at once, showing Loading Asset Libraries; the menu lists the
// catalogs once the window, handled until no job runs (wm_jobs_running), has ended the job. On one thread
// (Preferences > System > Bylonder > Threads Off, a page that is not cross-origin isolated) the same job runs to its end
// where it starts instead of never running.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const threads = process.env.WM_JOBS_THREADS ?? '4';
process.env.BYLONDER_THREADS = threads;
const { blenderMain, blenderModule, datafiles } = await import('../src/bmesh/bmesh-wasm.js');
await import('../src/python/bpy_interface.js');
const { setContextPointer } = await import('../src/python/bpy_rna.js');

await datafiles;
const { exports: x } = blenderModule;
const main = blenderMain();
setContextPointer(main.C);
main.run('mesh.primitive_cube_add', {});
const MENU = 'OBJECT_MT_modifier_add_root_catalogs';
const catalogs = () => (main.menu(MENU).text.match(/"menu":"OBJECT_MT_add_modifier_catalog_assets"/g) ?? []).length;

const start = performance.now();
const before = catalogs();
const drawn = performance.now() - start;
assert.ok(x.wm_jobs_running(main.C), 'drawing the menu started the asset list job');
let ticks = 0;
for (; x.wm_jobs_running(main.C) || x.wm_pending(main.C); ticks++) {
  assert.ok(performance.now() - start < 30000, 'the asset list job ends');
  x.wm_tick(main.C);
  await new Promise((resolve) => setTimeout(resolve, 5));
}
const loaded = performance.now() - start, after = catalogs();
assert.ok(after > before, `the menu lists the library's catalogs once the job ended: ${before} before, ${after} after`);
const times = `menu drawn in ${drawn.toFixed(0)} ms, catalogs listed after ${loaded.toFixed(0)} ms (${ticks} window ticks)`;

if (threads === '1') {
  console.log(times);
} else {
  assert.ok(drawn < loaded / 4, `the page went on while the job read the library: ${times}`);
  const inline = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { env: { ...process.env, WM_JOBS_THREADS: '1' }, encoding: 'utf8' });
  assert.equal(inline.status, 0, `on one thread: ${inline.stderr || inline.stdout}`);
  console.log(`wm jobs: the asset list loads on a job's thread, ${times}; on one thread where it starts, ${inline.stdout.trim()}`);
}
process.exit(0);
