// Records the character controller demo (docs/demos/character-controller) on a scripted walk, jog, turn and stop: a
// contact sheet of frames every 0.5 s at each of five window sizes, a short clip at 1920x1080, and its checks (foot
// sliding while planted, the largest frame-to-frame bone jump, the controller's cost per frame).
//   usage: node tools/docs/record-character-controller.mjs [out folder]  (default .shots/character-controller)
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, existsSync, statSync, writeFileSync, rmSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import ffmpeg from 'ffmpeg-static';
import { chromium } from '../../tests/e2e/app.mjs';

// DEMOS: another folder of demos to serve (a copy, while an export rewrites docs/demos).
const root = process.env.DEMOS ?? fileURLToPath(new URL('../../docs/demos/', import.meta.url));
const out = resolve(process.argv[2] ?? '.shots/character-controller');
// QUICK=1: one size, a few seconds, no clip, to check the page before a full recording.
const QUICK = !!process.env.QUICK;
const SIZES = QUICK ? [[1366, 768]] : [[1920, 1080], [1366, 768], [1024, 768], [390, 844], [844, 390]];
// Seconds, then the stick (x right, z forward, relative to the camera) and whether to run.
const SCRIPT = [[0, 0, 0, 0], [1, 0, 1, 0], [3.5, 0, 1, 1], [6, 0.8, 0.6, 1], [7.5, -0.6, 0.8, 0], [9.5, 0, 0, 0]];
const SECONDS = QUICK ? 4 : 11.5, SHEET_EVERY = 0.5, CLIP_FPS = 15;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png', '.jpg': 'image/jpeg' };

const server = createServer((req, res) => {
  const path = join(root, decodeURIComponent(req.url.split('?')[0]));
  const file = existsSync(path) && statSync(path).isDirectory() ? join(path, 'index.html') : path;
  if (!existsSync(file)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
  res.end(readFileSync(file));
}).listen(0);
const url = `http://localhost:${server.address().port}/character-controller/?measure&script=${encodeURIComponent(JSON.stringify(SCRIPT))}`;
const browser = await chromium.launch();

// One run at a size: frames every `every` seconds of the script's time, saved as <name>/NNN.png; the page's checks.
async function run([width, height], name, every) {
  const page = await browser.newPage({ viewport: { width, height } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url);
  await page.waitForFunction(() => window.demo?.metrics, null, { timeout: 300000 });
  const dir = join(out, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  // The script's clock starts at load; frames are taken by its time.
  const start = await page.evaluate(() => performance.now());
  for (let k = 0, t = 0; t <= SECONDS; k++, t = k * every) {
    await page.waitForFunction((at) => performance.now() >= at, start + t * 1000, { timeout: 60000, polling: 16 });
    await page.screenshot({ path: join(dir, `${String(k).padStart(3, '0')}.png`) });
  }
  const metrics = await page.evaluate(() => window.demo.summary());
  await page.close();
  return { size: `${width}x${height}`, ...metrics, errors };
}

mkdirSync(out, { recursive: true });
const results = [];
for (const size of SIZES) {
  const name = `${size[0]}x${size[1]}`;
  results.push(await run(size, name, SHEET_EVERY));
  const columns = size[0] > size[1] ? 6 : 8;
  execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-framerate', '1', '-i', join(out, name, '%03d.png'), '-vf',
    `scale=${size[0] > size[1] ? 320 : 180}:-1,drawtext=text='${name} %{eif\\:n*${SHEET_EVERY}\\:d\\:1}s':x=4:y=4:fontcolor=white:box=1:boxcolor=black@0.5,tile=${columns}x${Math.ceil((SECONDS / SHEET_EVERY + 1) / columns)}`,
    '-frames:v', '1', join(out, `sheet-${name}.png`)]);
}
if (!QUICK) {
  const clip = await run(SIZES[0], 'clip', 1 / CLIP_FPS);
  execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-framerate', String(CLIP_FPS), '-i', join(out, 'clip', '%03d.png'), '-vf', 'scale=960:-2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(out, 'clip.mp4')]);
  results.push(clip);
}
writeFileSync(join(out, 'checks.json'), JSON.stringify(results, null, 1));
console.log(results.map((r) => `${r.size}: cost ${r.costMs.toFixed(2)} ms, slide mean ${r.slideMeanMm.toFixed(1)} mm p95 ${r.slideP95Mm.toFixed(1)} mm, pop ${r.popMaxMm.toFixed(0)} mm, max jump ${r.jumpMaxMm.toFixed(0)} mm, ${r.transitions.join(' ')}${r.errors.length ? ` errors: ${r.errors.join('; ')}` : ''}`).join('\n'));
await browser.close();
server.close();
