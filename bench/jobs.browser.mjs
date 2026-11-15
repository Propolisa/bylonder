// Window-manager jobs in the app in Chromium, cross-origin isolated so they run on threads of their own: for each case,
// how long the call that starts the job holds the page, how long until the job ends, and the longest gap between the
// page's frames meanwhile (the page stays responsive when it is a frame or two). The cases: the Add Modifier menu's
// asset catalogs (an asset list), File > Append browsing inside a .blend (the File Browser's listing), the pose
// library's asset shelf (View > Asset Shelf in Pose Mode), and Edit Mode (which starts no job; for comparison).
// usage: node bench/jobs.browser.mjs [--off]   (E2E_URL: a running dev server, else dist/ is built and served)
// --off: Preferences > System > Bylonder > Threads Off, where each job runs where it starts, for comparison.
import { readFile } from 'node:fs/promises';
import { chromium, openApp, startServer } from '../tests/e2e/app.mjs';

// In the page: starts a case's job with `start` and handles the window each frame, as the app does, until no job runs.
const measure = async ({ runOperator }, { name, blend }) => {
  const { blenderMain, blenderModule } = await import('/src/bmesh/bmesh-wasm.js');
  const { tick } = await import('/src/windowmanager/wm-areas.js');
  const { setFileChooser } = await import('/src/windowmanager/wm-fileselect.js');
  const x = blenderModule.exports, blender = blenderMain(), C = blender.C;
  const frame = () => new Promise((done) => requestAnimationFrame(done));
  const cases = {
    asset_list: () => { blender.run('mesh.primitive_cube_add', {}); return () => blender.menu('OBJECT_MT_modifier_add_root_catalogs'); },
    file_browser: () => {
      setFileChooser({ open: async () => ({ files: [['rendering.blend', new Uint8Array(blend)]] }) });
      return () => blender.invoke('wm.append', {}, { type: 'LEFTMOUSE', value: 'PRESS', x: 0, y: 0 });
    },
    pose_library: () => {
      blender.run('object.armature_add', {});
      blender.run('object.mode_set', { mode: 'POSE' });
      blender.run('pose.select_all', { action: 'SELECT' });
      blender.run('poselib.create_pose_asset', { pose_name: 'Rest' });
      // View > Asset Shelf in the 3D Viewport: the shelf reads the pose library's asset list as it draws.
      return () => runOperator('wm.context_toggle', { data_path: 'space_data.show_region_asset_shelf' });
    },
    edit_mode: () => { blender.run('mesh.primitive_cube_add', {}); return () => blender.run('object.mode_set', { mode: 'EDIT' }); },
  };
  const start = cases[name]();
  await frame();
  let longest = 0, last = performance.now(), frames = 0;
  const t0 = performance.now();
  start();
  const held = performance.now() - t0;
  // The File Browser's job starts once its window opened: frames until a job ran and ended, the window handled as the
  // page handles it.
  let seen = false;
  for (let i = 0; i < 2000 && (x.wm_jobs_running(C) || (!seen && i < 120)); i++) {
    seen ||= x.wm_jobs_running(C);
    tick();
    await frame();
    const now = performance.now();
    longest = Math.max(longest, now - last);
    last = now;
    frames++;
  }
  return { held, ended: performance.now() - t0, longest, frames, seen, threads: blenderModule.threads };
};

const server = await startServer();
const browser = await chromium.launch();
const blend = [...await readFile(new URL('../examples/rendering/rendering.blend', import.meta.url))];
try {
  console.log(`${'case'.padEnd(14)} ${'held'.padStart(8)} ${'job ends'.padStart(9)} ${'longest frame'.padStart(14)}  (ms)`);
  for (const name of ['asset_list', 'file_browser', 'pose_library', 'edit_mode']) {
    const app = await openApp(browser, server.url, { init: process.argv.includes('--off') ? [() => localStorage.setItem('bylonder-threads', 'OFF')] : [] });
    const m = await app.bylonder(measure, { name, blend: name === 'file_browser' ? blend : null });
    console.log(`${name.padEnd(14)} ${m.held.toFixed(1).padStart(8)} ${m.ended.toFixed(0).padStart(9)} ${m.longest.toFixed(1).padStart(14)}  ${m.frames} frames, ${m.seen ? 'a job ran' : 'no job'}, ${m.threads} threads${app.errors.length ? `, page errors: ${app.errors.join('; ')}` : ''}`);
    await app.close();
  }
} finally {
  await browser.close();
  server.close();
}
