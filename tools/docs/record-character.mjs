// Records the Rigged Character's exported page reacting live (docs/features/import-export.md): the example's File >
// Export > JavaScript package as a page on WebGL 2 in Playwright's Chromium, its animation playing (the IK arms and legs,
// the head looking at the empty), then paused while the page's code moves the right hand's IK target in a circle and the
// empty side to side, the rig following through the constraints the page runs.
//   usage: node tools/docs/record-character.mjs
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ffmpeg } from '../media.mjs';
import { chromium } from '../../tests/e2e/app.mjs';
import { servePackages } from '../../tests/export-parity/look.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const MEDIA = join(root, 'docs/media/features/import-export');
// Pictures go where the owner follows them too: the main checkout's .shots/ beside a worktree, else this one's.
const SHOTS = join(existsSync(join(root, '../bylonder/.shots')) ? join(root, '../bylonder/.shots') : join(root, '.shots'), 'character');
const SIZE = { width: 720, height: 720 }, MAX_GIF = 1024 * 1024;
const HAND = 'objects["Rig"].pose.bones["hand_ik.R"].location', LOOK = 'objects["Look"].location[0]';

const PAGE = `<!doctype html><meta charset="utf-8"><title>Rigged Character</title><link rel="icon" href="data:,">
<style>html,body{margin:0;height:100%;background:#000;overflow:hidden}canvas{display:block;width:100%;height:100%}</style>
<script type="importmap">{ "imports": { "@babylonjs/core/": "/core/" } }</script>
<canvas id="c"></canvas>
<script type="module">
import { createEngine, load } from './scene.js';
Object.defineProperty(Navigator.prototype, 'gpu', { get: () => undefined });
const canvas = document.getElementById('c'), engine = await createEngine(canvas);
const blend = await load(engine);
engine.runRenderLoop(() => blend.scene.render());
window.blend = blend;
</script>`;

// The example's package, exported in a process of its own (Blender's module holds one Main), with the page beside it.
function exportPackage(dir) {
  const module = (path) => JSON.stringify(new URL(path, import.meta.url).href);
  const script = `
    const { openExample } = await import(${module('../../tests/open-example.js')});
    const { packageFiles } = await import(${module('../../tests/export-package.js')});
    const { exportModule } = await import(${module('../../src/io_scene_babylon/js-export.js')});
    const { mkdirSync, writeFileSync } = await import('node:fs');
    const { dirname, join } = await import('node:path');
    const { world, sync } = openExample('rigged-character');
    sync.view();
    const files = packageFiles(await exportModule(world, { target: 'WEBGL2', controlPanel: false }));
    for (const [path, data] of Object.entries(files)) { mkdirSync(dirname(join(${JSON.stringify(dir)}, path)), { recursive: true }); writeFileSync(join(${JSON.stringify(dir)}, path), data); }
    process.exit(0);`;
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] });
  if (run.status !== 0) throw new Error('exporting rigged-character failed');
  writeFileSync(join(dir, 'index.html'), PAGE);
}

const dir = mkdtempSync(join(tmpdir(), 'bylonder-character-'));
exportPackage(dir);
const server = servePackages(dir);
mkdirSync(MEDIA, { recursive: true });
mkdirSync(SHOTS, { recursive: true });
const browser = await chromium.launch();
const errors = [];
try {
  const context = await browser.newContext({ viewport: SIZE, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(server.url('index.html'));
  await page.waitForFunction(() => window.blend?.scene.isReady());
  const frames = mkdtempSync(join(tmpdir(), 'bylonder-frames-')), cdp = await context.newCDPSession(page);
  let count = 0, recording = true;
  cdp.on('Page.screencastFrame', ({ data, sessionId }) => {
    if (!recording) return;
    writeFileSync(join(frames, `${String(count++).padStart(5, '0')}.jpg`), Buffer.from(data, 'base64'));
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 90 });
  // The animation once through, then the targets moved by the page's code.
  await page.waitForTimeout(3200);
  await page.evaluate(async ({ hand, look }) => {
    const { blend } = window;
    blend.playhead.pause();
    blend.playhead.seek(1);
    const start = performance.now();
    await new Promise((done) => {
      const step = () => {
        const t = (performance.now() - start) / 1000, a = t * 2.4;
        blend.set(`${hand}[0]`, -0.15 + 0.15 * Math.cos(a));
        blend.set(`${hand}[2]`, 0.3 + 0.25 * Math.sin(a));
        blend.set(look, 1.4 * Math.sin(t * 1.3));
        if (t < 5) requestAnimationFrame(step); else done();
      };
      step();
    });
  }, { hand: HAND, look: LOOK });
  recording = false;
  await cdp.send('Page.stopScreencast');
  const out = join(MEDIA, 'character-live.gif');
  for (let w = 400; w === 400 || statSync(out).size > MAX_GIF; w = Math.round(w * 0.85)) {
    execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-framerate', '25', '-i', join(frames, '%05d.jpg'),
      '-vf', `crop=400:480:160:130,fps=12,scale=${w}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96[p];[b][p]paletteuse=dither=bayer:bayer_scale=4`, out]);
  }
  rmSync(frames, { recursive: true });
  copyFileSync(out, join(SHOTS, 'character-live.gif'));
  console.log(join(SHOTS, 'character-live.gif'));
  if (errors.length) throw new Error(errors.join('\n'));
} finally {
  await browser.close();
  server.close();
  rmSync(dir, { recursive: true, force: true });
}
process.exit(0);
