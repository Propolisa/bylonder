// A JavaScript package in a browser, on the GPU (one slot: ask the coordinator first): the Lava example with a world of
// nodes (tests/node-world.js), exported in Node, served as a page with @babylonjs/core from node_modules, and loaded on
// WebGL 2 and on WebGPU. Each engine: the page builds every material, its world bakes into the scene's light, a control
// set by path changes the drawn picture, and nothing reports an error. Pictures go to .shots/agents/exports/.
//   E2E_ENGINE=webgpu node tests/e2e/export-pages.mjs     (the flag turns on Chromium's WebGPU; both engines then run)
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { exportModule } from '../../src/io_scene_babylon/js-export.js';
import { openExample } from '../open-example.js';
import { nodeWorld } from '../node-world.js';
import { writePackage } from '../export-package.js';
import { GL_ARGS, E2E_CHROME } from './tools.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const shots = fileURLToPath(new URL('../../../bylonder/.shots/agents/exports/', import.meta.url));
mkdirSync(shots, { recursive: true });
execFileSync(process.execPath, [join(root, 'scripts/webgpu-compilers.mjs')], { cwd: root, stdio: 'inherit' });

// The package: Lava under a world of nodes, written with @babylonjs/core left as the page's import map resolves it.
const { world, sync, scene } = openExample('lava');
sync.view();
nodeWorld(scene);
const files = await exportModule(world);
const written = writePackage(Object.fromEntries(Object.entries(files)));
// writePackage points @babylonjs/core at node_modules for Node; the page maps it with an import map instead.
for (const name of ['scene.js', 'bylonder/blend-scene.js', 'bylonder/world.js']) {
  const path = join(written.dir, name);
  writeFileSync(path, readFileSync(path, 'utf8').replaceAll(JSON.stringify(import.meta.resolve('@babylonjs/core')), "'@babylonjs/core'"));
}
const strength = 'worlds["World"].node_tree.nodes["Background"].inputs[1].default_value';
const lavaInput = JSON.parse(/const CONTROLS = (.*);/.exec(files['scene.js'])[1]).find((c) => /^materials\[.*\.inputs\[\d+\]\.default_value$/.test(c.path)).path;
writeFileSync(join(written.dir, 'index.html'), `<!doctype html><meta charset="utf-8"><title>Exported package</title>
<style>html,body{margin:0;background:#000}canvas{width:640px;height:400px;display:block}</style>
<script type="importmap">{ "imports": { "@babylonjs/core": "/core/index.js" } }</script>
<canvas id="c" width="640" height="400"></canvas>
<script type="module">
import { Engine, WebGPUEngine } from '@babylonjs/core';
import { load } from './scene.js';
const errors = [];
addEventListener('error', (e) => errors.push(String(e.message)));
addEventListener('unhandledrejection', (e) => errors.push(String(e.reason?.message ?? e.reason)));
const canvas = document.getElementById('c'), kind = new URLSearchParams(location.search).get('engine');
const engine = kind === 'webgpu'
  ? await WebGPUEngine.CreateAsync(canvas, { glslangOptions: { jsPath: '/webgpu/glslang.js', wasmPath: '/webgpu/glslang.wasm' }, twgslOptions: { jsPath: '/webgpu/twgsl.js', wasmPath: '/webgpu/twgsl.wasm' } })
  : new Engine(canvas, true);
const blend = await load(engine), scene = blend.scene;
scene.materials.forEach((m) => m.onError = (effect, error) => errors.push(m.name + ': ' + error));
engine.runRenderLoop(() => scene.render());
const frames = (n) => new Promise((resolve) => { let i = 0; const o = scene.onAfterRenderObservable.add(() => { if (++i >= n) { scene.onAfterRenderObservable.remove(o); resolve(); } }); });
window.check = {
  errors,
  ready: () => scene.isReady() && scene.meshes.every((m) => !m.material || m.material.isReady(m)),
  notReady: () => scene.meshes.filter((m) => m.material && !m.material.isReady(m)).map((m) => m.name + ': ' + m.material.name),
  baked: () => scene.environmentTexture?.name === 'world' && !!scene.environmentTexture.sphericalPolynomial,
  frames,
  set: (path, value) => blend.set(path, value),
  engine: engine.getClassName(),
};
</script>`);

// A static server: the package at /, Babylon at /core/, its WebGPU compilers at /webgpu/.
const TYPES = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png', '.bin': 'application/octet-stream' };
const MOUNTS = [['/core/', join(root, 'node_modules/@babylonjs/core/')], ['/webgpu/', join(root, 'public/webgpu/')], ['/', written.dir + '/']];
const server = createServer((request, response) => {
  const url = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  const [prefix, dir] = MOUNTS.find(([p]) => url.startsWith(p)), path = join(dir, url.slice(prefix.length) || 'index.html');
  if (!existsSync(path) || statSync(path).isDirectory()) return void response.writeHead(404).end();
  response.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' }).end(readFileSync(path));
}).listen(0);
const port = server.address().port;

const playwright = createRequire(import.meta.url)('playwright');
const browser = await playwright.chromium.launch({ args: [...GL_ARGS, '--enable-unsafe-webgpu'], executablePath: E2E_CHROME });
const results = [];
try {
  for (const engine of ['webgl2', 'webgpu']) {
    const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
    const logs = [];
    page.on('console', (m) => m.type() === 'error' && logs.push(m.text()));
    page.on('pageerror', (e) => logs.push(e.message));
    await page.goto(`http://localhost:${port}/index.html?engine=${engine}`);
    await page.waitForFunction(() => window.check?.ready(), null, { timeout: 120000 }).catch(async (error) => {
      const state = await Promise.race([page.evaluate(() => window.check ? { errors: window.check.errors, notReady: window.check.notReady() } : 'no check: the module did not load'),
        new Promise((resolve) => setTimeout(() => resolve('the page does not answer'), 10000))]);
      await page.screenshot({ path: join(shots, `export-page-${engine}-stuck.png`), timeout: 5000 }).catch(() => {});
      throw new Error(`${engine}: not ready: ${JSON.stringify(state)} ${logs.slice(0, 5).join(' | ')}`);
    });
    await page.waitForFunction(() => window.check.baked(), null, { timeout: 60000 }).catch(() => {});
    await page.evaluate(() => window.check.frames(10));
    const before = join(shots, `export-page-${engine}.png`), after = join(shots, `export-page-${engine}-tuned.png`);
    const first = await page.locator('canvas').screenshot({ path: before });
    const baked = await page.evaluate(() => window.check.baked());
    await page.evaluate(([s, input]) => { window.check.set(s, 6); window.check.set(input, 0.25); }, [strength, lavaInput]);
    await page.evaluate(() => window.check.frames(10));
    const second = await page.locator('canvas').screenshot({ path: after });
    const errors = [...(await page.evaluate(() => window.check.errors)), ...logs];
    results.push({ engine: await page.evaluate(() => window.check.engine), baked, tuned: !first.equals(second), errors, pictures: [before, after] });
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
  written.remove();
}
console.log(JSON.stringify(results, null, 2));
for (const r of results) {
  assert.deepEqual(r.errors, [], `${r.engine}: no errors`);
  assert.ok(r.baked, `${r.engine}: the node world bakes into the scene's light`);
  assert.ok(r.tuned, `${r.engine}: the controls change the picture`);
}
console.log('Export pages: the Lava package with a node world loads, bakes and tunes on WebGL 2 and WebGPU');
process.exit(0);
