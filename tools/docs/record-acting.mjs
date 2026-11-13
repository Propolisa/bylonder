// Records Snow's mouth in the character controller demo playing the Bar Scene's acting (the Acting clip), frame by frame
// at the action's own 24 fps from its first frame, the camera in front of his lower lip: the page's half of a side by
// side with Blender's render of the same frames (render-acting.py). Prints the camera's vertical field of view.
// With Blender's cameras (render-acting.py's cameras.json), each frame is taken from Blender's camera.
//   usage: node tools/docs/record-acting.mjs [out folder] [frames] [cameras.json]  (default .shots/character-controller/acting-page, 292)
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, existsSync, statSync, rmSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '../../tests/e2e/app.mjs';

const root = fileURLToPath(new URL('../../docs/demos/', import.meta.url));
const out = resolve(process.argv[2] ?? '.shots/character-controller/acting-page'), FRAMES = Number(process.argv[3] ?? 292), FPS = 24;
const SIZE = { width: 640, height: 480 };
const cameras = process.argv[4] ? JSON.parse(readFileSync(process.argv[4], 'utf8')) : null;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png', '.jpg': 'image/jpeg', '.mp3': 'audio/mpeg' };
const server = createServer((req, res) => {
  const path = join(root, decodeURIComponent(req.url.split('?')[0]));
  const file = existsSync(path) && statSync(path).isDirectory() ? join(path, 'index.html') : path;
  if (!existsSync(file)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
  res.end(readFileSync(file));
}).listen(0);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: SIZE });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`http://localhost:${server.address().port}/character-controller/?step&act=0&cut`);
await page.waitForFunction(() => window.demo?.step, null, { timeout: 300000 });
// The help and credits are left out of the frames compared with Blender's.
await page.addStyleTag({ content: '#help{display:none}' });
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const view = { yaw: Math.PI, pitch: 0.05, distance: 0.75, at: 'DEF-OuterLip_Bot_Center', ease: 1000 };
for (let k = 0; k < FRAMES; k++) {
  await page.evaluate(([dt, v]) => window.demo.step(dt, v), [k ? 1 / FPS : 0, cameras ? { camera: cameras[k] } : view]);
  // A material still compiling skips its meshes (his head, the bar on the first frames): draw again once all are ready.
  await page.evaluate(async () => {
    const { scene } = window.demo.blend;
    while (!scene.isReady(true)) await new Promise((done) => setTimeout(done, 20));
    scene.render();
  });
  await page.screenshot({ path: join(out, `${String(k).padStart(4, '0')}.png`) });
}
console.log('fov', await page.evaluate(() => window.demo.blend.scene.activeCamera.fov));
if (errors.length) console.log(errors.join('; '));
await browser.close();
server.close();
