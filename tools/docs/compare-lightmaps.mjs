// Compares two bakes of the Meditation example (two .blend files, each exported as File > Export > JavaScript exports it,
// tools/docs/export-shot.mjs) in the page they export to: both drawn by WebGL 2 through the scene camera at frame 1, side
// by side with their difference (x4), and the colour at named spots of both with the difference, in a PNG and as text.
// On the GPU: hold its slot (.shots/gpu-yield).
//   usage: node tools/docs/compare-lightmaps.mjs <a.blend> <b.blend> <out.png> [label a] [label b]
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GL_ARGS, E2E_CHROME } from '../../tests/e2e/tools.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const [a, b, out, labelA = 'Desktop Blender', labelB = 'Bylonder'] = process.argv.slice(2);
const WIDTH = 960, HEIGHT = 540;
// Spots as fractions of the frame: what each shows of the room's light.
const SPOTS = [
  ['sun on the floor', 0.62, 0.86], ['floor in shade', 0.2, 0.9], ['back wall', 0.5, 0.25], ['wall by the window', 0.86, 0.3],
  ['turtle shell', 0.36, 0.8], ['cushion', 0.47, 0.72], ['figure, chest', 0.5, 0.5], ['ceiling corner', 0.08, 0.06],
];

const work = mkdtempSync(join(tmpdir(), 'bylonder-compare-'));
const packages = [a, b].map((blend, i) => {
  const dir = join(work, String(i));
  execFileSync(process.execPath, [join(root, 'tools/docs/export-shot.mjs'), resolve(blend), dir], { cwd: root, stdio: 'inherit' });
  writeFileSync(join(dir, 'index.html'), `<!doctype html><meta charset="utf-8"><title>Bake</title>
<style>html,body{margin:0;background:#000}canvas{width:${WIDTH}px;height:${HEIGHT}px;display:block}</style>
<script type="importmap">{ "imports": { "@babylonjs/core": "/node_modules/@babylonjs/core/index.js", "@babylonjs/": "/node_modules/@babylonjs/" } }</script>
<canvas id="c" width="${WIDTH}" height="${HEIGHT}"></canvas>
<script type="module">
import { Engine } from '@babylonjs/core';
import { load } from './scene.js';
const engine = new Engine(document.getElementById('c'), true, { preserveDrawingBuffer: true });
const blend = await load(engine), scene = blend.scene;
await blend.settled();
blend.playhead.pause();
blend.playhead.seek(1);
engine.runRenderLoop(() => scene.render());
window.ready = () => scene.isReady() && scene.meshes.every((m) => !m.material || m.material.isReady(m));
</script>`);
  return dir;
});

const TYPES = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png', '.jpg': 'image/jpeg' };
const server = createServer((request, response) => {
  const url = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  const path = url.startsWith('/node_modules/') ? join(root, url) : join(packages[Number(url.split('/')[1])], url.split('/').slice(2).join('/') || 'index.html');
  if (!existsSync(path) || statSync(path).isDirectory()) return void response.writeHead(404).end();
  response.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' }).end(readFileSync(path));
}).listen(0);
const port = server.address().port;

const playwright = createRequire(import.meta.url)('playwright');
const browser = await playwright.chromium.launch({ args: GL_ARGS, executablePath: E2E_CHROME });
try {
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
  page.on('pageerror', (error) => console.log('page error:', error.message));
  const frames = [];
  for (const i of [0, 1]) {
    await page.goto(`http://localhost:${port}/${i}/`);
    await page.waitForFunction(() => window.ready?.(), null, { timeout: 120000 });
    await page.waitForTimeout(1500);
    frames.push(await page.locator('canvas').evaluate((canvas) => canvas.toDataURL('image/png')));
  }
  // The side by side, drawn in the page: A, B and |A - B| x 4, the spots marked and measured.
  const result = await page.evaluate(async ({ frames, spots, labels }) => {
    const images = await Promise.all(frames.map((src) => new Promise((done) => { const image = new Image(); image.onload = () => done(image); image.src = src; })));
    const [w, h] = [images[0].width, images[0].height], pixels = images.map((image) => {
      const c = new OffscreenCanvas(w, h), g = c.getContext('2d');
      g.drawImage(image, 0, 0);
      return g.getImageData(0, 0, w, h);
    });
    const canvas = document.createElement('canvas'), header = 28;
    Object.assign(canvas, { width: w * 3, height: h + header });
    const g = canvas.getContext('2d');
    g.fillStyle = '#1d1d1d';
    g.fillRect(0, 0, canvas.width, canvas.height);
    images.forEach((image, i) => g.drawImage(image, i * w, header));
    const diff = new ImageData(w, h);
    let total = 0;
    for (let p = 0; p < w * h * 4; p += 4) {
      for (let c = 0; c < 3; c++) {
        const d = Math.abs(pixels[0].data[p + c] - pixels[1].data[p + c]);
        diff.data[p + c] = Math.min(255, d * 4);
        total += d;
      }
      diff.data[p + 3] = 255;
    }
    g.putImageData(diff, w * 2, header);
    g.font = '16px system-ui';
    g.fillStyle = '#e6e6e6';
    [labels[0], labels[1], 'Difference x4'].forEach((text, i) => g.fillText(text, i * w + 10, 20));
    const at = (data, x, y) => { const p = (Math.round(y * (h - 1)) * w + Math.round(x * (w - 1))) * 4; return [0, 1, 2].map((c) => data.data[p + c]); };
    const measured = spots.map(([name, x, y], n) => {
      const values = pixels.map((data) => at(data, x, y));
      for (let i = 0; i < 3; i++) {
        g.strokeStyle = '#ffbe33';
        g.lineWidth = 2;
        g.strokeRect(i * w + x * w - 6, header + y * h - 6, 12, 12);
        g.fillStyle = '#ffbe33';
        g.fillText(String(n + 1), i * w + x * w + 9, header + y * h + 5);
      }
      return { name, a: values[0], b: values[1], difference: Math.max(...values[0].map((v, c) => Math.abs(v - values[1][c]))) };
    });
    return { png: canvas.toDataURL('image/png'), measured, mean: total / (w * h * 3) };
  }, { frames, spots: SPOTS, labels: [labelA, labelB] });
  writeFileSync(out, Buffer.from(result.png.split(',')[1], 'base64'));
  console.log(`${out}: mean difference ${result.mean.toFixed(2)} of 255`);
  for (const [n, { name, a, b, difference }] of result.measured.entries()) console.log(`${n + 1} ${name}: ${a.join(' ')} vs ${b.join(' ')} (difference ${difference})`);
} finally {
  await browser.close();
  server.close();
  rmSync(work, { recursive: true, force: true });
}
