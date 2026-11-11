// The export parity matrix: every example's File > Export > JavaScript package against the app, by check and engine.
//   node: in Node, no GPU (evaluate.mjs, one process per example with a .blend): suggested controls at a few values and
//         frames of the animation give the app's transforms, meshes and material uniforms;
//   look: in Chromium on the GPU (look.mjs), on WebGL 2 and WebGPU: the page's picture against the app's Render Image,
//         within the example's tolerance (TOLERANCES), with no blank frame and no console or WebGPU error.
// Writes .shots/parity/export/report.md and report.json, and per failure of the look its side by side (app, page,
// difference) to .shots/parity/export/<example>-<engine>.png. Fails on a failure KNOWN does not list.
// Exports and results are cached per example by the tree they come from (node_modules/.cache/export-parity/).
//   node tests/export-parity/matrix.mjs [example ...] [--node] [--look] [--engines webgl2,webgpu] [--changed] [--prod]
//     --node, --look  only that part (default both); --changed  only the examples the changes since origin/main reach;
//     --prod  the app from dist/ (npm run build) instead of the dev server; E2E_URL a running app; JOBS Node processes;
//     LOOK_TIMEOUT  seconds one example's look may take before its row says it hangs (default 600);
//     EXPORT_OPTIONS  File > Export's options as JSON (export-options.js) the packages are made with;
//     --fresh  the cached results of the parts run go (a change to the checks themselves), the exports stay.
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exampleBlend } from '../open-example.js';

const root = fileURLToPath(new URL('../..', import.meta.url));
// Pictures go where the owner follows them: the main checkout's .shots/ beside a worktree, else this one's.
const MAIN = join(root, '../bylonder/.shots');
const SHOTS = process.env.PARITY_SHOTS ?? join(existsSync(MAIN) ? MAIN : join(root, '.shots'), 'parity/export'), CACHE = join(root, 'node_modules/.cache/export-parity');
const ENGINES = ['webgl2', 'webgpu'];

// The least share of pixels within look.mjs's STEPS and the largest mean difference (of 255) per example, and why an
// example is looser than the default.
const DEFAULT = { agree: 0.9, mean: 8 };
export const TOLERANCES = {
};

// Failures known and owned, by "<example> <check>" (check: controls, animation, export, look-webgl2, look-webgpu), with a
// one-line diagnosis guess. They are reported but do not fail the run; one that passes is reported as fixed.
export const KNOWN = {
  'solar look-webgl2': "88.7% of pixels agree: the edges of the stars' point cloud and the glow layer's halos differ (the planets agree)",
  "grease-pencil controls": "the export overflows the stack in Babylon's SceneSerializer (fixed on export-fixes-parity)",
  "grease-pencil animation": "the export overflows the stack in Babylon's SceneSerializer (fixed on export-fixes-parity)",
  'drivers-and-graph-editor controls': 'a Bevel width set live writes the old width back through its percentage twin (fixed on export-fixes-parity)',
  'newtons-cradle controls': 'Bevel width set live (fixed on export-fixes-parity)',
  'sculpting controls': 'Bevel width set live (fixed on export-fixes-parity)',
  "desk-lamp controls": "Bevel width set live on the Mug; the Lamp's skinned mesh off from load (live animation agent)",
  'desk-lamp animation': 'the armature-deformed Lamp mesh is off at every frame (live animation agent)',
  "lotus controls": "shape keys counted twice: the export redraws Main's evaluated mesh over the basis it morphs (live animation agent)",
  'lotus animation': 'shape keys counted twice (live animation agent)',
  'shape-keys controls': 'shape keys counted twice (live animation agent)',
  'shape-keys animation': 'shape keys counted twice (live animation agent)',
  "compositor animation": "the Aircraft Light material's animated emission does not play in the page; Tea Break's mesh off 0.02 at frame 89",
  'animation look-webgl2': 'the page skips the Standard view transform, so linear colors reach the screen unencoded (fixed on export-fixes-parity)',
  'animation look-webgpu': 'the page skips the Standard view transform, so linear colors reach the screen unencoded (fixed on export-fixes-parity)',
  'lava look-webgl2': 'the page skips the Standard view transform, so linear colors reach the screen unencoded (fixed on export-fixes-parity)',
  'lava look-webgpu': 'the page skips the Standard view transform, so linear colors reach the screen unencoded (fixed on export-fixes-parity)',
  'city look-webgpu': 'the page skips the Standard view transform, so linear colors reach the screen unencoded (fixed on export-fixes-parity)',
  'bouncing-ball look-webgl2': 'Grease Pencil strokes are not exported (fixed on export-grease-pencil), and the view transform',
  'bouncing-ball look-webgpu': 'Grease Pencil strokes are not exported (fixed on export-grease-pencil), and the view transform',
  'chess look-webgl2': 'the page does not load: this._light.needCube is not a function (a shadow generator on a light of another class)',
  'chess look-webgpu': 'the page does not load: this._light.needCube is not a function',
  'drivers-and-graph-editor look-webgpu': 'the page does not load: this._light.needCube is not a function',
  "coast look-webgpu": "the app itself fails: the Sky material's shader does not compile on WebGPU",
  'lumen look-webgl2': "48% of pixels agree: the app's neon follows Lumen's per-frame emission code under motion blur (shutter 0.8), which the page's static emission does not; framing and the lens match",
  'orrery look-webgl2': "78% of pixels agree: the plinth's and floor's reflections and the mechanism's lit parts differ (not yet classified)",
  'compositor look-webgl2': '14.5% of pixels agree: not yet classified, rerun once the view transform fix lands',
  'geometry-node-editor look-webgl2': '32% of pixels agree: not yet classified, rerun once the view transform fix lands',
  'geometry-nodes look-webgl2': '87% of pixels agree: the page draws no point clouds (the planet clouds, draw/pointcloud.js in the app)',
  'desk-lamp look-webgl2': 'the page is never ready within 180 s (a material never reports ready)',
  'cube look-webgpu': 'the page is never ready within 180 s (a material never reports ready)',
};
// Failures known by what they say, wherever they happen.
const KNOWN_ERRORS = [
  [/EnvironmentBRDFTexture/, 'the world cube BRDF sampler on WebGPU, fixed on branch webgpu-export'],
];
const knownOf = (key, verdict) => KNOWN[key] ?? KNOWN_ERRORS.find(([pattern]) => verdict.some((line) => pattern.test(line)))?.[1];

// What a change since origin/main reaches: an example's own files reach it; the exporter, its runtime, and what the
// export reads (modifiers, the scene's Blender data, nodes, drawing) reach every example; nothing else reaches any.
const EVERY = /^(src\/(io_scene_babylon|modifiers|runtimes|blenkernel|nodes|render|draw|bmesh|python|makesrna)\/|tests\/(export-parity\/|open-example\.js|export-package\.js)|tools\/blender-port\/|package-lock\.json$)/;
export function reachedExamples(files, all) {
  if (files.some((f) => EVERY.test(f))) return all;
  return all.filter((id) => files.some((f) => f.startsWith(`examples/${id}/`)));
}

const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28 });
const changedFiles = () => {
  const base = git('merge-base', 'HEAD', 'origin/main').trim();
  return [...git('diff', '--name-only', base).split('\n'), ...git('ls-files', '--others', '--exclude-standard').split('\n')].filter(Boolean);
};
// The cache key of an example: the contents of the files it is made from (committed or not alike), and the module.
function keyOf(id) {
  const paths = ['src', `examples/${id}`, 'tests/open-example.js', 'tests/export-package.js'];
  const hash = createHash('sha1');
  hash.update(git('ls-files', '-s', '--', ...paths));
  hash.update(git('diff', '--', ...paths));
  for (const file of git('ls-files', '--others', '--exclude-standard', '--', ...paths).split('\n').filter(Boolean)) hash.update(file + statSync(join(root, file)).mtimeMs);
  const module = statSync(join(root, 'src/bmesh/bmesh.wasm'), { throwIfNoEntry: false });
  hash.update(String([module?.size, module?.mtimeMs]));
  // Another checkout's app (E2E_URL) exports its own packages.
  hash.update(process.env.E2E_URL ?? '');
  hash.update(process.env.EXPORT_OPTIONS ?? '');
  return hash.digest('hex').slice(0, 16);
}

const run = (args) => new Promise((resolve) => {
  const child = spawn(process.execPath, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (d) => { output += d; });
  child.stderr.on('data', (d) => { output += d; });
  child.on('close', (code) => resolve({ code, output }));
});
const pool = async (items, jobs, work) => {
  let next = 0;
  await Promise.all(Array.from({ length: jobs }, async () => { while (next < items.length) await work(items[next++]); }));
};
// A result made once per tree; one that could not be made (an error) is made again next time.
const cached = (path, make) => (existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : make().then((value) => {
  if (!value.error) writeFileSync(path, JSON.stringify(value));
  return value;
}));

// The Node checks of one example: { controls, animation } each { checked, failures }, or { error } when the export or
// the evaluation fails.
async function nodeChecks(id, dir) {
  const { code, output } = await run(['tests/export-parity/evaluate.mjs', id, join(dir, 'node')]);
  const line = output.split('\n').find((l) => l.startsWith('{"id"'));
  if (line) return JSON.parse(line);
  const lines = output.split('\n').filter((l) => !l.startsWith('BJS') && l.trim());
  return { error: (lines.find((l) => /Error|error:/.test(l)) ?? lines.at(-1) ?? `exit ${code}`).trim().slice(0, 300) };
}

// The browser checks of the examples, one browser and one app server for all, each example's export made once.
// How long one example's look may take (LOOK_TIMEOUT, in seconds).
const LOOK_TIMEOUT = (Number(process.env.LOOK_TIMEOUT) || 600) * 1000;
async function lookChecks(ids, keys, engines, { prod }) {
  const { chromium, startServer } = await import('../e2e/app.mjs');
  const { GL_ARGS } = await import('../e2e/tools.mjs');
  const { appPicture, pagePicture, comparePictures, servePackages } = await import('./look.mjs');
  execFileSync(process.execPath, ['scripts/babylon-assets.mjs'], { cwd: root, stdio: 'ignore' });
  const server = prod || process.env.E2E_URL ? await startServer({ build: false }) : await devServer();
  const browser = await chromium.launch({ args: [...GL_ARGS, '--enable-unsafe-webgpu'], executablePath: process.env.E2E_CHROME });
  const served = servePackages(CACHE);
  const results = {};
  try {
    // Examples side by side in one browser (LOOK_JOBS), each one's engines in turn as its export is made once.
    await pool(ids, Number(process.env.LOOK_JOBS) || 3, async (id) => {
      const dir = join(CACHE, id, keys[id]);
      for (const engine of engines) {
        results[`${id} look-${engine}`] = await cached(join(dir, `look-${engine}.json`), async () => {
          const pictures = Object.fromEntries(['app', 'page', 'ids', 'side'].map((name) => [name, join(dir, `${name}-${engine}.png`)]));
          // A look that hangs (a page or Render Image that never finishes) is that example's row; the next one goes on.
          let timer;
          const hang = new Promise((_, reject) => { timer = setTimeout(() => reject(Error(`hang: no picture within ${LOOK_TIMEOUT / 1000} s`)), LOOK_TIMEOUT); });
          const look = (async () => {
            const app = await appPicture(browser, server.url, { id, engine, path: pictures.app, exportTo: !existsSync(join(dir, 'page/scene.js')) && join(dir, 'page') });
            const page = await pagePicture(browser, served, { folder: `${id}/${keys[id]}/page`, engine, ...app, path: pictures.page, idPath: pictures.ids });
            const title = `${id}   ${engine === 'webgpu' ? 'WebGPU' : 'WebGL 2'}   frame ${app.frame}`;
            const metrics = await comparePictures(browser, { ...pictures, legend: page.legend, title }, pictures.side);
            return { ...metrics, appErrors: app.errors, errors: page.errors, appStats: app.stats, pageStats: page.stats, pictures };
          })();
          // A look given up on fails later, when the browser closes under it: that failure is its hang, already reported.
          look.catch(() => {});
          try {
            return await Promise.race([hang, look]);
          } catch (error) {
            return { error: error.message.split('\n')[0].slice(0, 300), pictures };
          } finally {
            clearTimeout(timer);
          }
        });
        const r = results[`${id} look-${engine}`], verdict = verdictOf(id, r);
        // A failure's side by side is kept at once, outside the cache.
        if (verdict.length && existsSync(r.pictures.side)) writeFileSync(join(SHOTS, `${id}-${engine}.png`), readFileSync(r.pictures.side));
        console.log(`look ${id} ${engine}: ${verdict.join('; ') || 'ok'}${verdict.length ? ` (${join(SHOTS, `${id}-${engine}.png`)})` : ''}`);
      }
    });
  } finally {
    await browser.close();
    served.close();
    await server.close();
  }
  return results;
}

async function devServer() {
  const { createServer } = await import('vite');
  const server = await createServer({ root, logLevel: 'error', server: { port: 4331, strictPort: false } });
  await server.listen();
  return { url: server.resolvedUrls.local[0], close: () => server.close() };
}

// What the page's scene lacks of the app's: meshes (or their vertices), lights, the camera, morph targets, skins.
function statsDiff(app, page) {
  if (!app || !page) return [];
  const out = [], list = (names) => `${names.slice(0, 4).join(', ')}${names.length > 4 ? ` (+${names.length - 4})` : ''}`;
  const lacks = (what, a, b) => { const gone = a.filter((x) => !b.includes(x)); if (gone.length) out.push(`page lacks ${what}: ${list(gone)}`); };
  lacks('meshes', Object.keys(app.meshes), Object.keys(page.meshes));
  const vertices = Object.keys(app.meshes).filter((m) => m in page.meshes && page.meshes[m] !== app.meshes[m]);
  if (vertices.length) out.push(`vertices differ: ${list(vertices.map((m) => `${m} ${page.meshes[m]} (app ${app.meshes[m]})`))}`);
  lacks('lights', app.lights, page.lights);
  lacks('materials', app.materials, page.materials);
  lacks('morph targets on', app.morphed, page.morphed);
  lacks('skins on', app.skinned, page.skinned);
  if (app.camera !== page.camera) out.push(`camera: page ${page.camera}, app ${app.camera}`);
  return out;
}

// Where a look's differing pixels lie: the objects (and background) with the most, as "<name>: n% of its pixels".
const blameOf = (blame = {}) => Object.entries(blame).filter(([, b]) => b.differ > 0.02 * b.pixels && b.differ > 50)
  .sort(([, a], [, b]) => b.differ - a.differ).slice(0, 4).map(([name, b]) => `${name} ${Math.round((100 * b.differ) / b.pixels)}% of ${b.pixels} px`);

// Why a look result fails, as short lines (none: it passes).
function verdictOf(id, r) {
  if (r.error) return [r.error];
  const { agree, mean } = { ...DEFAULT, ...TOLERANCES[id] }, out = [...statsDiff(r.appStats, r.pageStats)];
  if (r.sizes[0] !== r.sizes[2] || r.sizes[1] !== r.sizes[3]) out.push(`sizes differ: app ${r.sizes.slice(0, 2).join('x')}, page ${r.sizes.slice(2).join('x')}`);
  if (r.litApp < 0.01) out.push('the app renders a blank or black frame');
  if (r.litPage < 0.01) out.push('the page draws a blank or black frame');
  if (r.errors.length) out.push(`page errors: ${[...new Set(r.errors)].slice(0, 2).join(' | ').slice(0, 240)}`);
  if (r.agree < agree || r.mean > mean) out.push(`${(r.agree * 100).toFixed(1)}% of pixels agree (needs ${agree * 100}%), mean difference ${r.mean.toFixed(1)} (at most ${mean}); differing: ${blameOf(r.blame).join(', ') || 'spread thin'}`);
  return out;
}

// Why a Node check of an example fails.
const nodeVerdict = (r, check) => (r.error ? [r.error] : [...(check === 'controls' ? r.baseline : []), ...r[check].failures]);

const args = process.argv.slice(2), flag = (name) => args.includes(name);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const engines = option('--engines')?.split(',') ?? ENGINES;
const parts = { node: flag('--node') || !flag('--look'), look: flag('--look') || !flag('--node') };
const all = readdirSync(join(root, 'examples')).filter((id) => existsSync(join(root, 'examples', id, 'index.js'))).sort();
const named = args.filter((a, i) => !a.startsWith('--') && !args[i - 1]?.match(/^--engines$/));
const ids = named.length ? named : flag('--changed') ? reachedExamples(changedFiles(), all) : all;
if (!ids.length) process.exit(console.log('export parity: no example is reached by the changes') ?? 0);

const keys = Object.fromEntries(ids.map((id) => [id, keyOf(id)]));
for (const id of ids) {
  // An example's older cached exports go: one key per example is kept.
  const base = join(CACHE, id);
  if (existsSync(base)) for (const old of readdirSync(base)) if (old !== keys[id]) rmSync(join(base, old), { recursive: true, force: true });
  mkdirSync(join(base, keys[id]), { recursive: true });
  const stale = (f) => (parts.node && f === 'node.json') || (parts.look && /^look-.*\.json$/.test(f));
  if (flag('--fresh')) for (const file of readdirSync(join(base, keys[id])).filter(stale)) rmSync(join(base, keys[id], file));
}
const start = performance.now(), results = {};
mkdirSync(SHOTS, { recursive: true });
if (parts.node) {
  const blends = ids.filter((id) => exampleBlend(id));
  await pool(blends, Number(process.env.JOBS) || Math.min(8, Math.max(1, Math.floor(availableParallelism() / 3))), async (id) => {
    const r = await cached(join(CACHE, id, keys[id], 'node.json'), () => nodeChecks(id, join(CACHE, id, keys[id])));
    for (const check of ['controls', 'animation']) results[`${id} ${check}`] = { verdict: nodeVerdict(r, check), checked: r[check]?.checked ?? 0, note: r.notes?.join('; ') };
    console.log(`node ${id}: ${r.error ? r.error : `controls ${r.controls.failures.length + r.baseline.length} of ${r.controls.checked} off, animation ${r.animation.failures.length} of ${r.animation.checked} off`}`);
  });
}
if (parts.look) {
  const looks = await lookChecks(ids, keys, engines, { prod: flag('--prod') });
  for (const [key, r] of Object.entries(looks)) results[key] = { verdict: verdictOf(key.split(' ')[0], r), metrics: r.error ? null : { agree: r.agree, mean: r.mean }, pictures: r.pictures };
}

// The report: a table of example by check, and each failure's lines and pictures.
const checks = [...(parts.node ? ['controls', 'animation'] : []), ...(parts.look ? engines.map((e) => `look-${e}`) : [])];
const cell = (key) => {
  const r = results[key];
  if (!r) return 'n/a';
  if (key.includes('look') && r.verdict.length) r.side = join(SHOTS, `${key.replace(' look-', '-')}.png`);
  r.known = knownOf(key, r.verdict);
  const state = r.verdict.length ? (r.known ? 'known' : 'FAIL') : KNOWN[key] ? 'fixed' : r.checked === 0 ? 'none' : 'ok';
  r.state = state;
  return state;
};
const rows = ids.map((id) => [id, ...checks.map((c) => cell(`${id} ${c}`))]);
const table = [['example', ...checks], ['---', ...checks.map(() => '---')], ...rows].map((row) => `| ${row.join(' | ')} |`).join('\n');
const failures = Object.entries(results).filter(([, r]) => r.verdict.length).map(([key, r]) => `- **${key}** (${r.state})${r.known ? `: ${r.known}` : ''}${r.side ? ` [side by side](${r.side})` : ''}\n${r.verdict.slice(0, 4).map((l) => `  - ${l}`).join('\n')}`);
const unexpected = Object.values(results).filter((r) => r.state === 'FAIL').length, fixed = Object.values(results).filter((r) => r.state === 'fixed').length;
const summary = `${ids.length} examples, ${Object.keys(results).length} checks in ${((performance.now() - start) / 1000).toFixed(0)} s: ${unexpected} failing, ${Object.values(results).filter((r) => r.state === 'known').length} known, ${fixed} fixed`;
writeFileSync(join(SHOTS, 'report.md'), `# Export parity\n\n${summary}\n\n${table}\n\n## Failures\n\n${failures.join('\n') || 'None.'}\n`);
writeFileSync(join(SHOTS, 'report.json'), JSON.stringify(results, null, 1));
console.log(`\n${table}\n\n${summary}\nreport: ${join(SHOTS, 'report.md')}`);
process.exit(unexpected ? 1 : 0);
