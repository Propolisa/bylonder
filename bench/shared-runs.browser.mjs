// Runs of one package on one engine (docs/notes/shared-runs.md), measured in headless Chromium on SwiftShader (CPU,
// real WebGL 2 buffers): the GPU buffers and textures each run creates and the bytes it uploads, the frame time of one
// run and of two, the second run drawing once the first is disposed, and loading again once every run is disposed.
//   node bench/shared-runs.browser.mjs [example]     (default rigged-character; writes shared-runs.png beside the package)
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import '../tests/e2e/tools.mjs';
import { chromium } from 'playwright';
import { openExample } from '../tests/open-example.js';
import { exportModule } from '../src/io_scene_babylon/js-export.js';
import { packageFiles } from '../tests/export-package.js';
import { servePackages } from '../tests/export-parity/look.mjs';

const PAGE = `<!doctype html><meta charset="utf-8"><style>body{margin:0}canvas{width:640px;height:320px}</style><canvas></canvas>
<script type="importmap">{ "imports": { "@babylonjs/core": "/core/index.js", "@babylonjs/core/": "/core/" } }</script>
<script type="module">
// Counts what the page asks of WebGL: buffers and textures made and deleted, bytes uploaded to buffers.
const gl = WebGL2RenderingContext.prototype, counts = { buffers: 0, textures: 0, deletedBuffers: 0, deletedTextures: 0, bufferBytes: 0 };
const counted = (name, key, f = () => 1) => { const call = gl[name]; gl[name] = function (...args) { counts[key] += f(...args); return call.apply(this, args); }; };
counted('createBuffer', 'buffers'); counted('createTexture', 'textures'); counted('deleteBuffer', 'deletedBuffers'); counted('deleteTexture', 'deletedTextures');
counted('bufferData', 'bufferBytes', (_, data) => (typeof data === 'number' ? data : data?.byteLength ?? 0));
const { Engine } = await import('@babylonjs/core');
const { load } = await import('./scene.js');
const { sharedStreams } = await import('./bylonder/shared-resources.js');
const engine = new Engine(document.querySelector('canvas'), false, { preserveDrawingBuffer: true });
const streams = () => { const { buffers, ...rest } = sharedStreams(engine); return rest; };
const runs = [], snapshot = () => ({ ...counts, streams: streams() });
const delta = (a, b) => Object.fromEntries(Object.keys(counts).map((k) => [k, b[k] - a[k]]));
// Each run draws in its own half of the canvas.
const place = () => runs.forEach((run, i) => { run.scene.autoClear = i === 0; run.scene.activeCamera.viewport.x = i / 2; run.scene.activeCamera.viewport.width = 1 / Math.max(2, runs.length); });
window.addRun = async () => {
  const before = snapshot(), started = performance.now(), run = await load(engine);
  await run.settled();
  run.playhead.pause();
  runs.push(run);
  place();
  for (const r of runs) r.scene.render();
  return { ms: Math.round(performance.now() - started), made: delta(before, snapshot()), streams: streams() };
};
window.frames = async (count = 30) => {
  const started = performance.now();
  for (let i = 0; i < count; i++) { for (const run of runs) run.scene.render(); await engine.readPixels(0, 0, 1, 1); }
  return +((performance.now() - started) / count).toFixed(2);
};
window.disposeRun = (i) => { runs.splice(i, 1)[0].dispose(); place(); return snapshot(); };
window.ready = true;
</script>`;

const example = process.argv[2] ?? 'rigged-character';
const { world, sync } = openExample(example);
sync.view();
const dir = mkdtempSync(join(tmpdir(), 'bylonder-shared-runs-'));
for (const [path, data] of Object.entries({ ...packageFiles(await exportModule(world)), 'index.html': PAGE })) {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), data);
}
const served = servePackages(dir);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--use-gl=angle'] });
try {
  const page = await browser.newPage({ viewport: { width: 640, height: 320 } });
  page.on('pageerror', (error) => console.error('page:', error.message));
  await page.goto(served.url('index.html'));
  await page.waitForFunction(() => window.ready, null, { timeout: 120000 });
  const first = await page.evaluate(() => window.addRun()), oneRun = await page.evaluate(() => window.frames());
  const second = await page.evaluate(() => window.addRun()), twoRuns = await page.evaluate(() => window.frames());
  await page.screenshot({ path: join(dir, 'shared-runs.png') });
  await page.evaluate(() => window.disposeRun(0));
  const afterDispose = await page.evaluate(() => window.frames());
  await page.screenshot({ path: join(dir, 'shared-runs-after-dispose.png') });
  await page.evaluate(() => window.disposeRun(0));
  const reset = await page.evaluate(() => window.addRun());
  console.log(JSON.stringify({ example, first, second, reset, frameMs: { oneRun, twoRuns, afterDispose } }, null, 1));
  console.log(`screenshots: ${join(dir, 'shared-runs.png')} ${join(dir, 'shared-runs-after-dispose.png')}`);
} finally {
  await browser.close();
  served.close();
}
process.exit(0);
