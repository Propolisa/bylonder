// Records the Noodle Shop game (docs/demos/noodle-shop/) for the Import and Export page: she walks up the lane, sits,
// buys a tea and sips it. Served from the folder as the site serves it; frames from Chromium's screencast, encoded with
// ffmpeg under 1 MB. With --shot, a still of the page as it opens, for tuning; with --sheet, the same play on a desktop, a
// laptop, a tablet and a phone held both ways (keys, or the thumb stick and E button on touch screens), each as a
// contact sheet of its frames every half second, to check frame by frame.
//   usage: node tools/docs/record-noodle-shop.mjs [--shot | --sheet] [out folder]
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '../../tests/e2e/app.mjs';
import { ffmpeg } from '../media.mjs';

const shot = process.argv.includes('--shot'), sheet = process.argv.includes('--sheet');
const out = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? fileURLToPath(new URL('../../docs/media/features/import-export/', import.meta.url));
const root = fileURLToPath(new URL('../../docs/demos/noodle-shop/', import.meta.url));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png' };
const server = createServer((req, res) => {
  const path = join(root, decodeURIComponent(new URL(req.url, 'http://page').pathname).replace(/\/$/, '/index.html'));
  try { res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' }).end(readFileSync(path)); } catch { res.writeHead(404).end(); }
}).listen(0);
const browser = await chromium.launch();
mkdirSync(out, { recursive: true });

// The play: walk up the lane, a step aside towards the shop window, on to the stool, sit, buy, sip, then walk back down
// the lane, turning round. Steps: [what, stick x, stick y (forward), ms], or [what, null, null, ms] for E.
const PLAY = [['walk', 0, 1, 1000], ['turn left', -1, 0, 300], ['walk', 0, 1, 800], ['sit', null, null, 2500], ['buy', null, null, 1500],
  ['sip', null, null, 3500], ['stand, turn and walk', 0, -1, 3000], ['stop', 0, 0, 1000]];
const VIEWPORTS = [['desktop', 1920, 1080], ['laptop', 1366, 768], ['tablet', 1024, 768, true], ['phone portrait', 390, 844, true], ['phone landscape', 844, 390, true]];

async function open({ width, height, touch = false }) {
  const page = await browser.newPage({ viewport: { width, height }, ...(touch && { isMobile: true, hasTouch: true, deviceScaleFactor: 2 }) });
  page.on('pageerror', (error) => console.error(error.message));
  await page.goto(`http://localhost:${server.address().port}/`);
  await page.waitForFunction(() => document.getElementById('say').textContent.includes('stool'), null, { timeout: 180000 });
  await page.waitForTimeout(3000);
  return page;
}

// Plays PLAY with keys, or on a touch screen with the left thumb stick and the E button; `mark(what)` as each step starts,
// `acted(what)` once E has done its step.
async function play(page, { width, height }, touch, mark, acted = async () => {}) {
  const cdp = await page.context().newCDPSession(page), stick = [Math.min(120, width / 4), height - Math.min(160, height / 4)];
  const thumb = (type, x = 0, y = 0) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: stick[0] + 60 * x, y: stick[1] - 60 * y }] });
  const keys = (x, y) => [x > 0 && 'KeyD', x < 0 && 'KeyA', y > 0 && 'KeyW', y < 0 && 'KeyS'].filter(Boolean);
  for (const [what, x, y, ms] of PLAY) {
    mark(what);
    if (x === null) {
      if (touch) await page.tap('#act'); else await page.keyboard.press('KeyE');
      await page.waitForTimeout(ms);
      await acted(what);
    } else if (touch) {
      await thumb('touchStart');
      await thumb('touchMove', x, y);
      await page.waitForTimeout(ms);
      await thumb('touchEnd');
    } else {
      for (const key of keys(x, y)) await page.keyboard.down(key);
      await page.waitForTimeout(ms);
      for (const key of keys(x, y)) await page.keyboard.up(key);
    }
  }
}

// The page's frames from Chromium's screencast while `run` runs, each with its time.
async function screencast(page, run, maxWidth) {
  const cdp = await page.context().newCDPSession(page), frames = [];
  cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    frames.push({ data, time: metadata.timestamp });
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 85, ...(maxWidth && { maxWidth, maxHeight: maxWidth }) });
  await run();
  await cdp.send('Page.stopScreencast');
  return frames;
}

if (shot) {
  const page = await open({ width: 960, height: 540 });
  const views = JSON.parse(process.env.VIEWS ?? '[null]');
  for (const [i, view] of views.entries()) {
    if (view) console.log(await page.evaluate((js) => eval(js), view));
    await page.waitForTimeout(1500);
    await page.screenshot({ path: join(out, `noodle-shop-${i}.png`) });
  }
}
else if (sheet) {
  for (const [name, width, height, touch] of VIEWPORTS) {
    const page = await open({ width, height, touch }), marks = [];
    const file = join(out, `noodle-shop-${name.replace(' ', '-')}-${width}x${height}`);
    // A still at full size as she buys her tea, its prompt as it reads.
    const acted = (what) => (what === 'buy' ? page.screenshot({ path: `${file}-buy.png` }) : null);
    const frames = await screencast(page, () => play(page, { width, height }, touch, (what) => marks.push({ what, time: Date.now() / 1000 }), acted), 640);
    // Every half second from the first step, each with the step it is in.
    const start = marks[0].time, end = frames.at(-1).time, picks = [];
    for (let t = 0; start + t <= end; t += 0.5) {
      const frame = frames.reduce((best, f) => (Math.abs(f.time - start - t) < Math.abs(best.time - start - t) ? f : best));
      picks.push({ t, data: frame.data, what: marks.findLast((m) => m.time <= start + t + 0.01)?.what ?? '' });
    }
    await page.close();
    const columns = width > height ? 6 : 10, cell = width > height ? 320 : 160;
    const sheetPage = await browser.newPage({ viewport: { width: columns * (cell + 6) + 12, height: 400 } });
    await sheetPage.setContent(`<body style="margin:6px;background:#111;color:#eee;font:13px system-ui">
<h3 style="margin:4px 0">Noodle Shop, ${name} ${width}x${height}${touch ? ', touch' : ', keys'}: a frame every 0.5 s</h3>
<div style="display:grid;grid-template-columns:repeat(${columns},${cell}px);gap:6px">${picks.map((p) => `<figure style="margin:0">
<img src="data:image/jpeg;base64,${p.data}" style="width:${cell}px;display:block"><figcaption>${p.t.toFixed(1)} s ${p.what}</figcaption></figure>`).join('')}</div>`);
    await sheetPage.waitForLoadState('load');
    await sheetPage.screenshot({ path: `${file}.png`, fullPage: true });
    await sheetPage.close();
    console.log(`${file}.png`);
  }
}
else {
  const page = await open({ width: 960, height: 540 });
  const frames = await screencast(page, () => play(page, { width: 960, height: 540 }, false, () => {}));
  const dir = mkdtempSync(join(tmpdir(), 'noodle-shop-')), end = frames.at(-1).time + 0.1;
  writeFileSync(join(dir, 'list.txt'), frames.map((f, i) => {
    writeFileSync(join(dir, `${i}.jpg`), Buffer.from(f.data, 'base64'));
    return `file '${join(dir, `${i}.jpg`).replaceAll('\\', '/')}'\nduration ${((frames[i + 1]?.time ?? end) - f.time).toFixed(3)}`;
  }).join('\n'));
  const file = join(out, 'noodle-shop.gif');
  for (const [width, colors, fps] of [[480, 96, 8], [400, 64, 8], [360, 48, 6], [320, 32, 6], [280, 32, 5], [240, 24, 5]]) {
    execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', join(dir, 'list.txt'), '-vf',
      `fps=${fps},scale=${width}:-2:flags=lanczos,split[a][b];[a]palettegen=max_colors=${colors}:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4`, '-loop', '0', file]);
    if (statSync(file).size < 1e6) break;
  }
  rmSync(dir, { recursive: true });
  console.log(`${file} ${(statSync(file).size / 1024).toFixed(0)} KB, ${frames.length} frames`);
}
await browser.close();
server.close();
process.exit(0);
