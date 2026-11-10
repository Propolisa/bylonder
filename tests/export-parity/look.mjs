// The export parity matrix's browser check (tests/export-parity/matrix.mjs): an example opened in the app, its Render
// Image through the scene camera, and its File > Export > JavaScript package as a page of the same size, on WebGL 2 or
// WebGPU, compared pixel by pixel. Either picture blank or black, an error in the console, or a WebGPU uncaptured or
// validation error fails it. Pictures and the side by side with their difference go to `shots`.
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { openApp } from '../e2e/app.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
// The output's width in the app's render and the page: small enough to be quick, large enough to see a material.
const WIDTH = 480;
// A channel difference within which two pixels agree (8 bit steps), and the least sum of a pixel's channels that is lit.
const STEPS = 12, LIT = 24;
// What the page's console says that fails it: Babylon logs WebGPU's validation errors as warnings.
const BAD_WARNING = /WebGPU uncaptured error|validation/i;

const TYPES = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png', '.jpg': 'image/jpeg', '.bin': 'application/octet-stream' };
// Serves package folders at /<name>/, with Babylon at /core/ and its WebGPU compilers at /webgpu/.
export function servePackages(dir, { port = 0, host } = {}) {
  const mounts = [['/core/', join(root, 'node_modules/@babylonjs/core/')], ['/webgpu/', join(root, 'public/webgpu/')], ['/', dir + '/']];
  const missing = [];
  const server = createServer((request, response) => {
    const url = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const [prefix, base] = mounts.find(([p]) => url.startsWith(p)), path = join(base, url.slice(prefix.length));
    if (!existsSync(path) || statSync(path).isDirectory()) return void (missing.push(url), response.writeHead(404).end());
    response.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' }).end(readFileSync(path));
  }).listen(port, host);
  // missing(): the paths asked for and not found since the last call.
  return { root: dir, url: (path) => `http://localhost:${port || server.address().port}/${path}`, missing: () => missing.splice(0), close: () => server.close() };
}

// A scene's statistics, run in the app's frame and in the page alike: its drawn meshes (vertices times instances) and
// their materials, its lights, the camera, and the meshes morphed or skinned. `keep` picks the scene's own nodes and
// `named` gives a mesh's name as the page has it.
const STATS = String((scene, keep, camera, named = (m) => m.name) => {
  const meshes = scene.meshes.filter((m) => m.isEnabled() && m.isVisible && m.getTotalVertices() > 0 && keep(m));
  const names = (list) => [...new Set(list)].sort();
  return {
    meshes: Object.fromEntries(meshes.map((m) => [named(m), m.getTotalVertices() * Math.max(1, m.thinInstanceCount || 0, (m.instances?.length ?? 0) + 1)])),
    materials: names(meshes.map((m) => m.material?.name).filter(Boolean)),
    lights: names(scene.lights.filter((l) => l.isEnabled() && keep(l)).map((l) => l.name)),
    camera,
    morphed: names(meshes.filter((m) => m.morphTargetManager?.numTargets).map(named)),
    skinned: names(meshes.filter((m) => m.skeleton).map(named)),
  };
});
// An object's color in the ID layer: three 3 bit channels, each the middle of its step, so blended edges stay apart.
const ID_STEP = 32;

// The page that loads a package on the engine its URL names, at a frame, with the canvas at the output's size. A package
// of modules imports Babylon module by module through an import map; a bundled one carries Babylon and its engine,
// whose classes the page takes from its scene's objects.
const MODULES = `<script type="importmap">{ "imports": { "@babylonjs/core/": "/core/" } }</script>
<canvas id="c"></canvas>
<script type="module">
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color.js';
import { load } from './scene.js';
import { WEBGPU_OPTIONS } from './bylonder/overrides/webgpu/maximum-limits.js';
const query = new URLSearchParams(location.search), canvas = document.getElementById('c');
size(canvas);
const engine = query.get('engine') === 'webgpu'
  ? await (await import('@babylonjs/core/Engines/webgpuEngine.js')).WebGPUEngine.CreateAsync(canvas, { ...WEBGPU_OPTIONS, glslangOptions: { jsPath: '/webgpu/glslang.js', wasmPath: '/webgpu/glslang.wasm' }, twgslOptions: { jsPath: '/webgpu/twgsl.js', wasmPath: '/webgpu/twgsl.wasm' } })
  : new (await import('@babylonjs/core/Engines/engine.js')).Engine(canvas, true, { preserveDrawingBuffer: true });
const blend = await load(engine), scene = blend.scene;
const standardMaterial = async () => (await import('@babylonjs/core/Materials/standardMaterial.js')).StandardMaterial;`;
const BUNDLED = `<canvas id="c"></canvas>
<script type="module">
import { createEngine, load } from './scene.js';
const query = new URLSearchParams(location.search), canvas = document.getElementById('c');
size(canvas);
// The package's createEngine picks WebGPU where the browser has it.
if (query.get('engine') !== 'webgpu') Object.defineProperty(navigator, 'gpu', { value: undefined });
const engine = await createEngine(canvas, { preserveDrawingBuffer: true }), blend = await load(engine), scene = blend.scene;
const Color3 = scene.ambientColor.constructor, Color4 = scene.clearColor.constructor;
// A bundle without Babylon's StandardMaterial has no ID layer.
const standardMaterial = async () => { try { return scene.defaultMaterial.constructor; } catch { return null; } };`;
const pageHtml = (bundled) => `<!doctype html><meta charset="utf-8"><title>Exported package</title>
<link rel="icon" href="data:,">
<style>html,body{margin:0;background:#000}canvas{display:block}</style>
<script>
var errors = [];
addEventListener('error', (e) => errors.push(String(e.message)));
addEventListener('unhandledrejection', (e) => errors.push(String(e.reason?.message ?? e.reason)));
function size(canvas) {
  const query = new URLSearchParams(location.search);
  Object.assign(canvas, { width: +query.get('width'), height: +query.get('height') });
  Object.assign(canvas.style, { width: query.get('width') + 'px', height: query.get('height') + 'px' });
}
</script>
${bundled ? BUNDLED : MODULES}
const frame = +query.get('frame');
scene.materials.forEach((m) => m.onError = (effect, error) => errors.push(m.name + ': ' + error));
// The app's frame, held: Render Image draws one still.
for (const group of scene.animationGroups) { group.start(false, 1, frame, frame); group.goToFrame(frame); group.pause(); }
await blend.settled();
engine.runRenderLoop(() => scene.render());
window.check = {
  errors,
  ready: () => scene.isReady() && scene.meshes.every((m) => !m.material || m.material.isReady(m)),
  notReady: () => scene.meshes.filter((m) => m.material && !m.material.isReady(m)).map((m) => m.name + ': ' + m.material.name),
  frames: (n) => new Promise((resolve) => { let i = 0; const o = scene.onAfterRenderObservable.add(() => { if (++i >= n) { scene.onAfterRenderObservable.remove(o); resolve(); } }); }),
  stats: () => (${STATS})(scene, () => true, scene.activeCamera?.name),
  // The ID layer: each drawn mesh in a flat color of its own on black, unlit and without post processes. Gives the
  // mesh of each color.
  async idLayer() {
    const StandardMaterial = await standardMaterial();
    if (!StandardMaterial) return {};
    Object.assign(scene, { postProcessesEnabled: false, fogEnabled: false, clearColor: new Color4(0, 0, 0, 1) });
    scene.imageProcessingConfiguration.isEnabled = false;
    if (scene.frameGraph) scene.frameGraph = null;
    const legend = {};
    scene.meshes.filter((m) => m.isEnabled() && m.isVisible && m.getTotalVertices() > 0).forEach((mesh, i) => {
      const rgb = [i + 1, (i + 1) >> 3, (i + 1) >> 6].map((v) => (v & 7) * ${ID_STEP} + ${ID_STEP / 2});
      legend[rgb.join(',')] = mesh.name;
      const material = new StandardMaterial('id ' + i, scene);
      Object.assign(material, { disableLighting: true, emissiveColor: Color3.FromInts(...rgb), backFaceCulling: false });
      mesh.material = material;
      if ('useVertexColors' in mesh) mesh.useVertexColors = false;
      if (mesh.color) mesh.color = Color3.FromInts(...rgb);
    });
    return legend;
  },
};
</script>`;

// The app's side: the example opened, rendered through its camera at WIDTH, and (once, `exportTo`) exported to a folder.
export async function appPicture(browser, url, { id, engine, path, exportTo }) {
  const app = await openApp(browser, `${url}?gpu=${engine}`, { link: id, node: null });
  try {
    const { width, height, frame } = await app.bylonder((b, width) => {
      const scene = b.modules.bpyRna.idStruct(b.world.mainSync.blender.scene);
      scene.render.resolution_percentage = Math.max(1, Math.round((100 * width) / scene.render.resolution_x));
      b.world.renderSettings.state.render.resolutionPercentage = scene.render.resolution_percentage;
      // One sample, as the page draws.
      b.world.renderSettings.state.eevee.taaRenderSamples = 1;
      const { resolution_x: x, resolution_y: y, resolution_percentage: p } = scene.render;
      return { width: Math.max(4, Math.round((x * p) / 100)), height: Math.max(4, Math.round((y * p) / 100)), frame: scene.frame_current };
    }, WIDTH);
    await app.settled();
    // The scene's own objects as the render shows them (render visibility), and its curves meshes (not their overlay's),
    // named as the page names them: `<object node>/curves/<particle system, or curves for a Curves object>`.
    const stats = await app.bylonder((b, source) => {
      const sync = b.world.mainSync, rna = b.modules.bpyRna;
      const curves = (node) => /^__curves (\d+):(-?\d+)$/.exec(node.name);
      const keep = (node) => !!curves(node) || (!!sync.objectOf(node) && !rna.idStruct(sync.objectOf(node)).hide_render);
      const named = (node) => {
        const [, ob, system] = curves(node) ?? [];
        if (!ob) return node.name;
        const owner = b.world.objects.find((n) => sync.objectOf(n) === Number(ob));
        return `${owner?.id}/curves/${+system < 0 ? 'curves' : rna.idStruct(sync.objectOf(owner)).particle_systems[+system].name}`;
      };
      return (0, eval)(source)(b.world.scene, keep, rna.idStruct(sync.blender.scene).camera?.name, named);
    }, STATS);
    await app.bylonder((b) => b.renderHost.renderImage());
    await app.until(() => /^(Finished|Render failed)/.test(document.querySelector('.render-result [data-status]').textContent), null, 300000);
    const status = await app.frame().evaluate(() => document.querySelector('.render-result [data-status]').textContent);
    if (/^Render failed/.test(status)) throw Error(status);
    const png = await app.frame().evaluate(() => document.querySelector('.render-result canvas').toDataURL('image/png'));
    writeFileSync(path, Buffer.from(png.split(',')[1], 'base64'));
    await app.frame().locator('.render-result [data-close]').click();
    if (exportTo) await exportPackage(app, exportTo);
    return { width, height, frame, stats, errors: app.errors.filter((e) => !/^\[vite\]/.test(e)) };
  } finally {
    await app.close();
  }
}

// File > Export > JavaScript (.zip), unzipped into `dir`.
async function exportPackage(app, dir) {
  const download = app.page.waitForEvent('download', { timeout: 300000 });
  // Failed with the app when a step below fails first, its failure that step's.
  download.catch(() => {});
  await app.page.click('[data-blender="TOPBAR_MT_file"]');
  await app.page.getByRole('menuitem', { name: /^Export/ }).first().hover();
  await app.page.getByRole('menuitem', { name: 'JavaScript (.zip)' }).click();
  // The export's settings open in the 3D Viewport's frame.
  await app.frame().locator('[role="dialog"][aria-label^="Export"]').getByRole('button', { name: 'Export' }).click();
  const chunks = [];
  for await (const chunk of await (await download).createReadStream()) chunks.push(chunk);
  for (const [path, data] of Object.entries(unzipSync(Buffer.concat(chunks)))) {
    if (path.endsWith('/')) continue;
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), data);
  }
}

// The page's side: the package in `served` at `folder`, drawn at the app's size and frame.
export async function pagePicture(browser, served, { folder, engine, width, height, frame, path, idPath }) {
  writeFileSync(join(served.root, folder, 'parity.html'), pageHtml(existsSync(join(served.root, folder, 'bundle'))));
  const page = await browser.newPage({ viewport: { width, height } }), logs = [];
  served.missing();
  page.on('console', (m) => (m.type() === 'error' || BAD_WARNING.test(m.text())) && logs.push(m.text()));
  page.on('pageerror', (e) => logs.push(e.message));
  try {
    // Not until load: the page's module awaits the whole scene, which the check below waits for.
    await page.goto(served.url(`${folder}/parity.html?engine=${engine}&width=${width}&height=${height}&frame=${frame}`), { waitUntil: 'commit', timeout: 120000 });
    await page.waitForFunction(() => window.check?.ready(), null, { timeout: 180000 }).catch(async () => {
      const state = await page.evaluate(() => (window.check ? { errors: window.check.errors, notReady: window.check.notReady() } : 'the package did not load')).catch(() => 'no answer');
      throw Error(`not ready: ${JSON.stringify(state)} ${logs.slice(0, 3).join(' | ')}`);
    });
    await page.evaluate(() => window.check.frames(20));
    await page.locator('canvas').screenshot({ path });
    const errors = [...(await page.evaluate(() => window.check.errors)), ...logs, ...served.missing().map((path) => `404 ${path}`)];
    const stats = await page.evaluate(() => window.check.stats());
    const legend = await page.evaluate(() => window.check.idLayer());
    await page.evaluate(() => window.check.frames(3));
    await page.locator('canvas').screenshot({ path: idPath });
    return { errors, stats, legend };
  } finally {
    await page.close();
  }
}

// Two pictures compared in a page: the share of pixels within STEPS, the mean difference, the share of each that is
// lit, and per object of the page's ID layer (`ids`, its colors' meshes in `legend`) how many of its pixels differ.
// Saved to `out`: a title, then app, page, difference (times 4) and the ID layer side by side, each captioned.
export async function comparePictures(browser, { app, page, ids, legend, title }, out) {
  const tab = await browser.newPage();
  const url = (path) => `data:image/png;base64,${readFileSync(path).toString('base64')}`;
  try {
    const result = await tab.evaluate(async ([a, b, idImage, legend, title, steps, lit, step]) => {
      const image = (src) => new Promise((resolve) => { const i = new Image(); i.onload = () => resolve(i); i.src = src; });
      const [x, y, z] = await Promise.all([image(a), image(b), image(idImage)]), w = x.width, h = x.height, top = 22, bottom = 18;
      const canvas = Object.assign(document.createElement('canvas'), { width: w * 4, height: h + top + bottom }), c = canvas.getContext('2d');
      const pixels = (source) => { c.drawImage(source, 0, top, w, h); return c.getImageData(0, top, w, h).data; };
      const r = pixels(z), q = pixels(y), p = pixels(x), d = c.createImageData(w, h);
      // An ID pixel's mesh: each channel within a quarter step of a step's middle, else an edge between meshes.
      const meshAt = (i) => (r[i] + r[i + 1] + r[i + 2] < 8 ? 'background'
        : [r[i], r[i + 1], r[i + 2]].every((v) => Math.abs((v % step) - step / 2) <= step / 4) ? legend[[r[i], r[i + 1], r[i + 2]].map((v) => Math.floor(v / step) * step + step / 2).join(',')] ?? 'edge' : 'edge');
      const blame = {};
      let close = 0, sum = 0, litApp = 0, litPage = 0;
      for (let i = 0; i < p.length; i += 4) {
        const diff = Math.max(Math.abs(p[i] - q[i]), Math.abs(p[i + 1] - q[i + 1]), Math.abs(p[i + 2] - q[i + 2]));
        const owner = (blame[meshAt(i)] ??= { pixels: 0, differ: 0 });
        owner.pixels++;
        if (diff <= steps) close++; else owner.differ++;
        if (p[i] + p[i + 1] + p[i + 2] > lit) litApp++;
        if (q[i] + q[i + 1] + q[i + 2] > lit) litPage++;
        sum += diff;
        d.data[i] = d.data[i + 1] = d.data[i + 2] = Math.min(255, diff * 4);
        d.data[i + 3] = 255;
      }
      c.fillStyle = '#202020';
      c.fillRect(0, 0, canvas.width, canvas.height);
      c.drawImage(x, 0, top, w, h);
      c.drawImage(y, w, top, w, h);
      c.putImageData(d, w * 2, top);
      c.drawImage(z, w * 3, top, w, h);
      c.fillStyle = '#e0e0e0';
      c.font = 'bold 14px sans-serif';
      c.fillText(title, 6, 16);
      c.font = '12px sans-serif';
      ['app Render Image', 'exported page', 'difference x4', 'page ID layer (object per color)'].forEach((caption, k) => c.fillText(caption, k * w + 6, top + h + 13));
      const n = w * h;
      return { agree: close / n, mean: sum / n, litApp: litApp / n, litPage: litPage / n, sizes: [x.width, x.height, y.width, y.height], blame, png: canvas.toDataURL('image/png') };
    }, [url(app), url(page), url(ids), legend, title, STEPS, LIT, ID_STEP]);
    writeFileSync(out, Buffer.from(result.png.split(',')[1], 'base64'));
    delete result.png;
    return result;
  } finally {
    await tab.close();
  }
}
