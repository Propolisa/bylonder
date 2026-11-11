// Records the Noodle Shop game (docs/demos/noodle-shop/) for the Import and Export page: she walks up the lane, sits,
// buys a tea and sips it. Served from the folder as the site serves it; frames from Chromium's screencast, encoded with
// ffmpeg under 1 MB. With --shot, a still of the page as it opens, for tuning.
//   usage: node tools/docs/record-noodle-shop.mjs [--shot] [out folder]
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '../../tests/e2e/app.mjs';
import { ffmpeg } from '../media.mjs';

const shot = process.argv.includes('--shot');
const out = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? fileURLToPath(new URL('../../docs/media/features/import-export/', import.meta.url));
const root = fileURLToPath(new URL('../../docs/demos/noodle-shop/', import.meta.url));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png' };
const server = createServer((req, res) => {
  const path = join(root, decodeURIComponent(new URL(req.url, 'http://page').pathname).replace(/\/$/, '/index.html'));
  try { res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' }).end(readFileSync(path)); } catch { res.writeHead(404).end(); }
}).listen(0);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.on('pageerror', (error) => console.error(error.message));
await page.goto(`http://localhost:${server.address().port}/`);
await page.waitForFunction(() => document.getElementById('say').textContent.startsWith('WASD'), null, { timeout: 180000 });
await page.waitForTimeout(3000);
mkdirSync(out, { recursive: true });

if (shot) {
  const views = JSON.parse(process.env.VIEWS ?? '[null]');
  for (const [i, view] of views.entries()) {
    if (view) console.log(await page.evaluate((js) => eval(js), view));
    await page.waitForTimeout(1500);
    await page.screenshot({ path: join(out, `noodle-shop-${i}.png`) });
  }
}
else {
  const cdp = await page.context().newCDPSession(page), frames = [];
  cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    frames.push({ data, time: metadata.timestamp });
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 90 });
  const hold = async (key, ms) => { await page.keyboard.down(key); await page.waitForTimeout(ms); await page.keyboard.up(key); };
  // Up the lane to the stool, then sit, buy and sip.
  await hold('KeyD', 5300);
  await hold('KeyW', 400);
  for (const wait of [1500, 1500, 4500]) { await page.keyboard.press('KeyE'); await page.waitForTimeout(wait); }
  await cdp.send('Page.stopScreencast');
  const dir = mkdtempSync(join(tmpdir(), 'noodle-shop-')), end = frames.at(-1).time + 0.1;
  writeFileSync(join(dir, 'list.txt'), frames.map((f, i) => {
    writeFileSync(join(dir, `${i}.jpg`), Buffer.from(f.data, 'base64'));
    return `file '${join(dir, `${i}.jpg`).replaceAll('\\', '/')}'\nduration ${((frames[i + 1]?.time ?? end) - f.time).toFixed(3)}`;
  }).join('\n'));
  const file = join(out, 'noodle-shop.gif');
  for (const [width, colors, fps] of [[480, 96, 8], [400, 64, 8], [360, 48, 6], [320, 32, 6]]) {
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
