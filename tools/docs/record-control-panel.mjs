// Records the pictures of an exported page's control panel (docs/features/import-export.md): the Lava example exported
// with custom properties added (CUSTOM below), bundled, as a page on WebGL 2 in Playwright's Chromium: the panel opened
// from the top right corner, a field dragged, a search and Show All; then on a phone, a finger scrolling the panel and
// dragging a field, and a pinch scaling it. Each step checks what it shows.
//   usage: node tools/docs/record-control-panel.mjs [--mobile] [--colours] [--serve]
//     --mobile  the phone's part only
//     --colours the materials' icons in the colours they show on screen, on the Compositor example, only
//     --serve   exports and serves the page, printing its URL, until stopped (for working on the panel); EXAMPLE another
//               example, PORT and HOST where (default any port on localhost)
//     BUNDLE=0  the package as ES modules, with an import map
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
const SHOTS = join(existsSync(join(root, '../bylonder/.shots')) ? join(root, '../bylonder/.shots') : join(root, '.shots'), 'control-panel');
const COLOURS = process.argv.includes('--colours');
const EXAMPLE = process.env.EXAMPLE ?? (COLOURS ? 'compositor' : 'lava');
// Custom properties the page's author would have added, by object (or the scene).
const CUSTOM = EXAMPLE !== 'lava' ? {} : { Sphere: { Glow: 0.75, Spin: true, Turns: 3 }, scene: { Speed: 2 } };
// Bundled, as File > Export writes a package by default, unless BUNDLE=0.
const BUNDLE = process.env.BUNDLE !== '0';
const SIZE = { width: 1100, height: 680 }, PHONE = { width: 390, height: 760 };
const MAX_GIF = 1024 * 1024;
const GLOW = '.row[data-path$="[\\"Glow\\"]"] .num';

const PAGE = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${EXAMPLE}</title><link rel="icon" href="data:,">
<style>html,body{margin:0;height:100%;background:#000;overflow:hidden}canvas{display:block;width:100%;height:100%;outline:0;touch-action:none}</style>
<script type="importmap">{ "imports": { "@babylonjs/core/": "/core/" } }</script>
<canvas id="c"></canvas>
<script type="module">
import { createEngine, load } from './scene.js';
// WebGL 2 unless ?webgpu: the pictures need no WebGPU, which a headless browser may lack.
if (!location.search.includes('webgpu')) Object.defineProperty(Navigator.prototype, 'gpu', { get: () => undefined });
const canvas = document.getElementById('c'), engine = await createEngine(canvas);
const blend = await load(engine);
addEventListener('resize', () => engine.resize());
engine.runRenderLoop(() => blend.scene.render());
window.blend = blend;
</script>`;

// The example's package, exported in a process of its own (Blender's module holds one Main), with the page beside it.
function exportPackage(dir) {
  const module = (path) => JSON.stringify(new URL(path, import.meta.url).href);
  const script = `
    const { openExample } = await import(${module('../../tests/open-example.js')});
    const { bundledFiles, packageFiles } = await import(${module('../../tests/export-package.js')});
    const { exportModule } = await import(${module('../../src/io_scene_babylon/js-export.js')});
    const { setCustomProperty } = await import(${module('../../src/blenkernel/animation/anim-blender.js')});
    const { mkdirSync, writeFileSync } = await import('node:fs');
    const { dirname, join } = await import('node:path');
    const { world, sync, objects } = openExample(${JSON.stringify(EXAMPLE)});
    for (const [owner, props] of Object.entries(${JSON.stringify(CUSTOM)})) for (const [key, value] of Object.entries(props))
      setCustomProperty(owner === 'scene' ? sync.blender.scene : sync.objectOf(objects.find((n) => n.name === owner)), key, value);
    const bundle = ${BUNDLE}, files = await (bundle ? bundledFiles : packageFiles)(await exportModule(world, { bundle }));
    for (const [path, data] of Object.entries(files)) { mkdirSync(dirname(join(${JSON.stringify(dir)}, path)), { recursive: true }); writeFileSync(join(${JSON.stringify(dir)}, path), data); }
    process.exit(0);`;
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] });
  if (run.status !== 0) throw new Error(`exporting ${EXAMPLE} failed`);
  writeFileSync(join(dir, 'index.html'), PAGE);
}

const dir = mkdtempSync(join(tmpdir(), 'bylonder-control-panel-'));
exportPackage(dir);
const server = servePackages(dir, { port: Number(process.env.PORT ?? 0), host: process.env.HOST });
const url = server.url('index.html');
if (process.argv.includes('--serve')) {
  console.log(url);
  await new Promise(() => {});
}

mkdirSync(MEDIA, { recursive: true });
mkdirSync(SHOTS, { recursive: true });
const browser = await chromium.launch();
const errors = [];
const toShots = (path, name) => {
  copyFileSync(path, join(SHOTS, name));
  console.log(join(SHOTS, name));
};

// A page of the package with its scene ready, and what to record it with.
async function open(context) {
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url);
  await page.waitForFunction(() => window.blend?.scene.isReady());
  const pause = (ms) => page.waitForTimeout(ms);
  const shot = async (name, target = page, options = {}) => {
    const path = join(MEDIA, `control-panel-${name}.png`);
    await target.screenshot({ path, ...options });
    toShots(path, `${name}.png`);
  };
  // A GIF of what `steps` do, from a screencast of the page, cropped to [x, y, width, height] (none: the whole page)
  // and scaled to `width`.
  const gif = async (name, crop, width, steps) => {
    const frames = mkdtempSync(join(tmpdir(), 'bylonder-frames-'));
    const cdp = await context.newCDPSession(page);
    let count = 0, recording = true;
    cdp.on('Page.screencastFrame', ({ data, sessionId }) => {
      if (!recording) return;
      writeFileSync(join(frames, `${String(count++).padStart(5, '0')}.jpg`), Buffer.from(data, 'base64'));
      cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
    });
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 90 });
    try {
      await steps();
    } finally {
      recording = false;
      await cdp.send('Page.stopScreencast');
      const out = join(MEDIA, `control-panel-${name}.gif`);
      // Smaller until under 1 MB, as the docs' GIFs are.
      for (let w = width; w === width || statSync(out).size > MAX_GIF; w = Math.round(w * 0.85)) {
        execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-framerate', '25', '-i', join(frames, '%05d.jpg'),
          '-vf', `${crop ? `crop=${crop[2]}:${crop[3]}:${crop[0]}:${crop[1]},` : ''}fps=10,scale=${w}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96[p];[b][p]paletteuse=dither=bayer:bayer_scale=4`, out]);
      }
      rmSync(frames, { recursive: true });
      toShots(out, `${name}.gif`);
    }
  };
  const panel = page.locator('[data-bylonder="control-panel"] .panel'), toggle = page.locator('[data-bylonder="control-panel"] .toggle');
  const value = (path) => page.evaluate((p) => window.blend.get(p), path);
  return { page, panel, toggle, pause, shot, gif, value };
}

// The materials, each icon in the colour it shows on screen, sampled with On Screen's shares.
if (COLOURS) {
  const { page, panel, toggle, pause, shot } = await open(await browser.newContext({ viewport: SIZE, deviceScaleFactor: 1 }));
  await page.mouse.move(SIZE.width - 30, 30, { steps: 8 });
  await toggle.click();
  await panel.locator('.share', { hasText: '%' }).first().waitFor();
  await pause(1000);
  const tints = await panel.locator('.dot.materials').evaluateAll((dots) => dots.map((d) => d.style.getPropertyValue('--tint')));
  if (new Set(tints.filter((t) => t.startsWith('rgb'))).size < 5) throw new Error(`the materials' icons took too few colours from the screen: ${tints.join(', ')}`);
  await page.mouse.move(SIZE.width / 3, SIZE.height / 2);
  await pause(300);
  await shot('material-colours');
  await page.close();
} else if (!process.argv.includes('--mobile')) {
  const { page, panel, toggle, pause, shot, gif, value } = await open(await browser.newContext({ viewport: SIZE, deviceScaleFactor: 1 }));
  // The button shows as the pointer nears the corner; the panel opens on it.
  await page.mouse.move(SIZE.width - 30, 30, { steps: 8 });
  await pause(300);
  await shot('button', page, { clip: { x: SIZE.width - 320, y: 0, width: 320, height: 160 } });
  await toggle.click();
  await panel.waitFor();
  await pause(400);
  await shot('open', panel);

  // A drag of the Glow custom property, Ctrl snapping it, then Escape undoing it; then the Noise Texture's Detail.
  await gif('drag', [SIZE.width / 2, 0, SIZE.width / 2, SIZE.height], 440, async () => {
    const box = await panel.locator(GLOW).boundingBox(), y = box.y + box.height / 2;
    await page.mouse.move(box.x + box.width / 2, y, { steps: 6 });
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 120, y, { steps: 20 });
    await page.keyboard.down('Control');
    await page.mouse.move(box.x + box.width / 2 + 60, y, { steps: 12 });
    await page.keyboard.up('Control');
    await pause(300);
    await page.keyboard.press('Escape');
    await page.mouse.up();
    if (await value('objects["Sphere"]["Glow"]') !== 0.75) throw new Error('Escape did not undo the drag');
    await pause(300);
    const detail = await panel.locator('.row', { hasText: 'Detail' }).first().locator('.num').boundingBox();
    await page.mouse.move(detail.x + detail.width / 2, detail.y + detail.height / 2, { steps: 6 });
    await page.mouse.down();
    await page.mouse.move(detail.x + detail.width / 2 - 160, detail.y + detail.height / 2, { steps: 30 });
    await page.mouse.up();
    await pause(500);
  });

  // A search, and Show All.
  await panel.locator('input[type=search]').fill('rough');
  await pause(300);
  await shot('search', panel);
  await panel.locator('input[type=search]').fill('');
  await panel.getByRole('button', { name: 'All', exact: true }).click();
  await pause(300);
  await shot('all', panel);
  await page.close();
}

// On a phone: a tap at the corner shows the button, one finger scrolls the panel or drags a field sideways, two pinch
// the panel's scale; with Orbit chosen, a finger outside the panel turns the view.
if (!COLOURS) {
  const { page, panel, toggle, pause, gif, value } = await open(await browser.newContext({ viewport: PHONE, deviceScaleFactor: 2, isMobile: true, hasTouch: true }));
  const cdp = await page.context().newCDPSession(page);
  const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y], id) => ({ x, y, id })) });
  // Fingers moved from `from` to `to`, an [x, y] each, in steps.
  const swipe = async (from, to, steps = 16) => {
    await touch('touchStart', from);
    for (let i = 1; i <= steps; i++) {
      await touch('touchMove', from.map(([x, y], f) => [x + ((to[f][0] - x) * i) / steps, y + ((to[f][1] - y) * i) / steps]));
      await pause(20);
    }
    await touch('touchEnd', []);
  };
  const scale = () => panel.evaluate((p) => Number(getComputedStyle(p).getPropertyValue('--cp-scale') || 1));
  const camera = () => page.evaluate(() => window.blend.scene.activeCamera.getWorldMatrix().asArray().join());
  await gif('touch', null, 240, async () => {
    await page.touchscreen.tap(PHONE.width - 20, 24);
    await pause(700);
    await toggle.tap();
    await panel.waitFor();
    await pause(400);
    const body = panel.locator('.body'), box = await body.boundingBox(), middle = box.x + box.width / 2;
    await swipe([[middle, box.y + box.height - 40]], [[middle, box.y + 60]]);
    await pause(500);
    if (!(await body.evaluate((b) => b.scrollTop) > 0)) throw new Error('one finger did not scroll the panel');
    await body.evaluate((b) => b.scrollTo({ top: 0, behavior: 'smooth' }));
    await pause(500);
    const glow = await panel.locator(GLOW).boundingBox(), before = await value('objects["Sphere"]["Glow"]');
    await swipe([[glow.x + 30, glow.y + glow.height / 2]], [[glow.x + glow.width - 10, glow.y + glow.height / 2]]);
    await pause(300);
    if (await value('objects["Sphere"]["Glow"]') === before) throw new Error('a finger sideways did not drag the field');
    const [x, y] = [middle, box.y + box.height / 2];
    await swipe([[x - 30, y], [x + 30, y]], [[x - 90, y], [x + 90, y]]);
    await pause(500);
    if (!(await scale() > 1.2)) throw new Error('a pinch did not scale the panel');
    await swipe([[x - 90, y], [x + 90, y]], [[x - 50, y], [x + 50, y]]);
    await pause(400);
    await panel.getByRole('radio', { name: 'Orbit' }).tap();
    await pause(300);
    await toggle.tap();
    const view = await camera();
    await swipe([[80, PHONE.height - 160]], [[240, PHONE.height - 140]]);
    await pause(500);
    if (await camera() === view) throw new Error("a finger outside the panel did not orbit the scene's camera");
  });
  await page.close();
}

await browser.close();
server.close();
rmSync(dir, { recursive: true });
if (errors.length) throw new Error(`the page reported: ${errors.join('; ')}`);
