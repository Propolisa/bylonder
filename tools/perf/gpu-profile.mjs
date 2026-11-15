// GPU profiler: where a page's GPU time goes, per render pass, compute dispatch and shader, from WebGPU timestamp
// queries around every pass (gpu-profile-hook.js). Opens an example in the dev server on WebGPU, lets it settle (or
// plays it in the Game area with PLAY=1), records FRAMES animation frames, prints the passes sorted by their GPU time per
// frame and writes every frame to a JSON file as it comes, so a stopped run still leaves its data.
//   usage: node tools/perf/gpu-profile.mjs <example> <node> [out.json]
//   PLAY=1          profile the playing game (STACK=VIEWPORT for the Viewport modifier stack, CAP minutes to wait for it)
//   FRAMES=120      frames to record; WARMUP seconds before recording (3, none with PLAY: from the game's first frame)
//   TRACE=out.json  also a Chrome trace of the recorded frames (CDP Tracing, GPU categories), for Perfetto
//   MARKERS=0       leave out Babylon's and Bylonder's debug groups (on by default: they label the passes)
//   SHADERS=dir     also write the source of every shader the page made into dir, by the names the JSON's `pipelines`
//                   list gives (every pipeline made, in order, with its shaders' names and code sizes)
//   E2E_CHROME      an installed Chrome to run (DXC shader compiles), as the browser checks do
// The example opens by its #example= link, so its .blend must be in examples/<example>/ while this runs.
import { createWriteStream, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, openApp } from '../../tests/e2e/app.mjs';
import { appServer, play, gameFps, logPage } from './play.mjs';

const [example, node, out = 'gpu-profile.json'] = process.argv.slice(2);
if (!example || !node) throw Error('usage: node tools/perf/gpu-profile.mjs <example> <node> [out.json]');
const FRAMES = Number(process.env.FRAMES ?? 120), WARMUP = Number(process.env.WARMUP ?? (process.env.PLAY ? 0 : 3)) * 1000;
const server = await appServer(4331), { url } = server;
// Unquantized timestamps (Chrome rounds them to 100 microseconds otherwise).
const browser = await chromium.launch({ args: ['--enable-webgpu-developer-features', '--disable-dawn-features=timestamp_quantization'] });
const t0 = performance.now(), since = () => `${Math.round((performance.now() - t0) / 1000)} s`;
// The hook runs in every document of the app (the 3D Viewport's frame, which draws the game, too) before its scripts.
const init = [{ path: fileURLToPath(new URL('gpu-profile-hook.js', import.meta.url)) }, ...(process.env.MARKERS === '0' ? [] : [{ content: 'globalThis.BYLONDER_GPU_MARKERS = true;' }]),
  ...(process.env.SHADERS ? [{ content: 'globalThis.__gpuProfileCode = true;' }] : [])];
const app = await openApp(browser, `${url}?gpu=webgpu`, { link: example, node, init });
logPage(app.page, since);
console.log(since(), 'opened', example);
if (process.env.PLAY) {
  const playing = await play(app, { stack: process.env.STACK ?? 'RENDER', cap: Number(process.env.CAP ?? 20) * 60000 });
  console.log(since(), playing ? 'playing' : 'Play did not draw in time; profiling what draws');
} else await app.settled();
const trace = process.env.TRACE && await app.context.newCDPSession(app.page);
if (trace) await trace.send('Tracing.start', { transferMode: 'ReturnAsStream', traceConfig: { includedCategories: ['toplevel', 'v8.execute', 'gpu', 'gpu.dawn', 'disabled-by-default-gpu.dawn', 'gpu.service', 'disabled-by-default-gpu.service'] } });

// Every document's frames, merged by the order they were recorded (the 3D Viewport frame draws the game).
const takeAll = async () => (await Promise.all(app.page.frames().map((f) => f.evaluate(() => {
  const p = globalThis.__gpuProfile;
  if (!p) return null;
  // Only frames whose timestamps are all read.
  const done = p.frames.findIndex((f) => f.pending > 0);
  return { timestamps: p.timestamps, frames: p.frames.splice(0, done < 0 ? p.frames.length : done).map(({ pending, ...f }) => f) };
}).catch(() => null)))).filter(Boolean);
await takeAll();
await new Promise((resolve) => setTimeout(resolve, WARMUP));
const file = createWriteStream(out);
file.write(`{"example":${JSON.stringify(example)},"frames":[\n`);
const frames = [];
let timestamps = 'unknown', lastFrame = performance.now();
// Until FRAMES are in, or nothing new came for STALL seconds (a page that draws nothing on WebGPU).
while (frames.length < FRAMES && performance.now() - lastFrame < Number(process.env.STALL ?? 120) * 1000) {
  await new Promise((resolve) => setTimeout(resolve, 500));
  for (const taken of await takeAll()) {
    timestamps = taken.timestamps;
    for (const f of taken.frames.filter((f) => f.passes.length)) {
      file.write(`${frames.length ? ',\n' : ''}${JSON.stringify(f)}`);
      frames.push(f);
      lastFrame = performance.now();
    }
  }
}
const made = (await Promise.all(app.page.frames().map((f) => f.evaluate(() => globalThis.__gpuProfile && { pipelines: globalThis.__gpuProfile.pipelines, code: globalThis.__gpuProfile.code }).catch(() => null)))).filter(Boolean);
file.end(`\n],\n"pipelines":${JSON.stringify(made.flatMap((m) => m.pipelines))}}\n`);
if (process.env.SHADERS) {
  mkdirSync(process.env.SHADERS, { recursive: true });
  for (const { code } of made) for (const [name, source] of Object.entries(code)) writeFileSync(join(process.env.SHADERS, `${name.replace(/[^\w.#-]+/g, '_')}.wgsl`), source);
}
console.log(since(), `${frames.length} frames recorded, timestamps ${timestamps}`, process.env.PLAY ? `, game at ${await gameFps(app, 3000).catch(() => '?')} fps` : '');

if (trace) {
  const ended = new Promise((resolve) => trace.once('Tracing.tracingComplete', resolve));
  await trace.send('Tracing.end');
  const { stream } = await ended, chunks = [];
  for (let eof = false; !eof;) { const r = await trace.send('IO.read', { handle: stream }); chunks.push(r.base64Encoded ? Buffer.from(r.data, 'base64').toString() : r.data); eof = r.eof; }
  writeFileSync(process.env.TRACE, chunks.join(''));
  console.log('trace', process.env.TRACE);
}
console.log(table(frames));
await browser.close();
await server.close();
process.exit(0);

// Passes summed per label over the frames: GPU ms per frame, passes per frame, then the shaders inside them.
function table(frames) {
  const n = frames.length || 1, rows = new Map(), shaders = new Map(), counts = {};
  let total = 0;
  for (const f of frames) {
    for (const [k, v] of Object.entries(f.counts)) counts[k] = (counts[k] ?? 0) + v;
    for (const p of f.passes) {
      const names = Object.keys(p.shaders), key = `${p.kind.padEnd(7)} ${[p.group, p.label || (p.kind === 'compute' ? names.join(' + ') : '')].filter(Boolean).join(' > ')}${p.target ? ` [${p.target}]` : ''}`;
      const row = rows.get(key) ?? rows.set(key, { ms: 0, passes: 0, dispatches: 0, workgroups: 0, draws: 0 }).get(key);
      row.ms += p.ms ?? 0; row.passes++; row.dispatches += p.dispatches; row.workgroups += p.workgroups; row.draws += p.draws;
      total += p.ms ?? 0;
      // A pass's time goes to its shaders by their share of its dispatches (compute) or draws (render).
      const units = p.kind === 'compute' ? p.dispatches : p.draws;
      for (const [name, s] of Object.entries(p.shaders)) {
        const row = shaders.get(name) ?? shaders.set(name, { ms: 0, uses: 0, workgroups: 0 }).get(name);
        row.ms += (p.ms ?? 0) * ((p.kind === 'compute' ? s.dispatches : s.draws) / (units || 1)); row.uses += p.kind === 'compute' ? s.dispatches : s.draws; row.workgroups += s.workgroups;
      }
    }
  }
  const ms = (v) => (v / n).toFixed(3).padStart(9);
  const per = (v) => (v / n).toFixed(1).padStart(8);
  const lines = [`GPU time over ${frames.length} frames: ${ms(total).trim()} ms per frame in passes`,
    `per frame: ${Object.entries(counts).map(([k, v]) => `${k} ${+(v / n).toFixed(1)}`).join(', ')}`, '',
    `${'ms/frame'.padStart(9)} ${'passes'.padStart(8)} ${'dispatch'.padStart(8)} ${'wgroups'.padStart(8)} ${'draws'.padStart(8)}  pass`];
  for (const [key, r] of [...rows].sort((a, b) => b[1].ms - a[1].ms).slice(0, Number(process.env.ROWS ?? 40))) lines.push(`${ms(r.ms)} ${per(r.passes)} ${per(r.dispatches)} ${per(r.workgroups)} ${per(r.draws)}  ${key}`);
  lines.push('', `${'ms/frame'.padStart(9)} ${'uses'.padStart(8)} ${'wgroups'.padStart(8)}  shader`);
  for (const [name, r] of [...shaders].sort((a, b) => b[1].ms - a[1].ms).slice(0, Number(process.env.ROWS ?? 40))) lines.push(`${ms(r.ms)} ${per(r.uses)} ${per(r.workgroups)}  ${name}`);
  return lines.join('\n');
}
