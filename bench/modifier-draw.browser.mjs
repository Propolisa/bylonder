// bench/modifier-draw.bench.js in the built app in Chromium: a modifier value set on a dense grid (as its panel's field
// sets it) to the frame that shows it, split into Main's evaluation, the evaluated Mesh's extraction, the draw (JS
// buffers and their upload) and the frame (its render until its pixels are read back). Software GL (llvmpipe), so GPU
// times are CPU times. Then the drag's release (an undo step) to its frame, and the JS heap with each result drawn
// (module memory: the Node bench).
// usage: flock /root/work/build.lock node bench/modifier-draw.browser.mjs [runs] [100k|1M]   (builds dist/ when stale)
// PROFILE=dir writes each case's CPU profile of the page's main thread there (raster is the GPU process's).
import { writeFileSync } from 'node:fs';
import { chromium, openApp, startServer } from '../tests/e2e/app.mjs';

const runs = Number(process.argv[2] ?? 5), sizes = process.argv[3] ? [process.argv[3]] : ['100k', '1M'];
const side = (faces) => Math.round(Math.sqrt(faces));
const cases = (faces) => [
  { name: 'Subdivision', grid: side(faces / 16), type: 'SUBSURF', values: { levels: 1 }, path: 'levels', from: 1, to: 2 },
  { name: 'Array', grid: side(faces / 10), type: 'ARRAY', values: { count: 9 }, path: 'count', from: 9, to: 10 },
  { name: 'Displace', grid: side(faces), type: 'DISPLACE', values: { strength: 0.5 }, path: 'strength', from: 0.5, to: 0.6 },
];

// In the page: a grid with the case's modifier, then its value set `runs` times, each timed to its drawn frame.
const measure = async ({ world, runOperator }, { c, runs }) => {
  const { blender } = world.mainSync, scene = world.scene, gl = scene.getEngine()._gl;
  const spent = { evaluate: 0, extract: 0 };
  const timed = (name, step) => { const own = blender[name]; blender[name] = (...args) => { const t = performance.now(); try { return own.apply(blender, args); } finally { spent[step] += performance.now() - t; } }; return () => { blender[name] = own; }; };
  runOperator('mesh.primitive_grid_add', { x_subdivisions: c.grid, y_subdivisions: c.grid, size: 2 });
  const node = world.objects.at(-1), modifier = world.modifiers.add(node, c.type, c.values);
  const frame = () => new Promise((done) => {
    let start = 0;
    scene.onBeforeRenderObservable.addOnce(() => { start = performance.now(); });
    scene.onAfterRenderObservable.addOnce(() => { gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4)); done(performance.now() - start); });
  });
  const restore = [timed('evaluate', 'evaluate'), timed('evaluatedMesh', 'extract')];
  const steps = { evaluate: [], extract: [], draw: [], frame: [], total: [], release: [] };
  try {
    for (let i = 0; i < runs + 1; i++) {
      world.modifiers.set(node, modifier.id, c.path, c.from, { finish: false });
      await frame();
      spent.evaluate = spent.extract = 0;
      const t0 = performance.now();
      world.modifiers.set(node, modifier.id, c.path, c.to, { finish: false });
      const t1 = performance.now(), drawn = await frame(), t2 = performance.now();
      if (!i) continue;
      steps.evaluate.push(spent.evaluate); steps.extract.push(spent.extract);
      steps.draw.push(t1 - t0 - spent.evaluate - spent.extract); steps.frame.push(drawn); steps.total.push(t2 - t0);
      // The drag's release: its value set as the last of the drag, an undo step, to the next frame.
      const t3 = performance.now();
      world.modifiers.set(node, modifier.id, c.path, c.to, { finish: true });
      await frame();
      steps.release.push(performance.now() - t3);
    }
  } finally { restore.forEach((r) => r()); }
  const median = (v) => v.sort((a, b) => a - b)[v.length >> 1];
  const result = Object.fromEntries(Object.entries(steps).map(([k, v]) => [k, median(v)]));
  result.faces = blender.evaluatedMesh(world.mainSync.objectOf(node)).faces_num;
  result.heap = performance.memory?.usedJSHeapSize;
  runOperator('object.delete', {});
  return result;
};

const MB = (bytes) => `${(bytes / 2 ** 20).toFixed(0)} MB`, ms = (v) => v.toFixed(1).padStart(7);
const server = await startServer();
const browser = await chromium.launch();
try {
  const app = await openApp(browser, server.url);
  console.log(`${'case'.padEnd(26)} ${'faces'.padStart(8)}   evaluate  extract     draw    frame    total  release  (ms, median of ${runs})`);
  for (const size of sizes) for (const c of cases(size === '1M' ? 1e6 : 1e5)) {
    const profiler = process.env.PROFILE && (await app.page.context().newCDPSession(app.page));
    if (profiler) { await profiler.send('Profiler.enable'); await profiler.send('Profiler.start'); }
    const m = await app.bylonder(measure, { c, runs });
    if (profiler) writeFileSync(`${process.env.PROFILE}/${c.name}-${size}.cpuprofile`, JSON.stringify((await profiler.send('Profiler.stop')).profile));
    console.log(`${(c.name + ' ' + size).padEnd(26)} ${String(m.faces).padStart(8)}  ${ms(m.evaluate)}  ${ms(m.extract)}  ${ms(m.draw)}  ${ms(m.frame)}  ${ms(m.total)}  ${ms(m.release)}   JS heap ${MB(m.heap)}`);
  }
  if (app.errors.length) console.log('page errors:', app.errors);
} finally {
  await browser.close();
  server.close();
}
