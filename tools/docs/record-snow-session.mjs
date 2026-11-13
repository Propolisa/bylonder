// Records Snow's session on the Character Controller demo (docs/demos/character-controller) in one go, on the page's
// own clock (?step: window.demo.step(dt, view)): walk, run and sprint; a turn in place; up and down the slope and the
// steps with feet on (side and foot views); a close-up of the face on the ramp; and the take-over (the seated acting
// with its dialogue, the first tap, then input). Each shot has a timeout and checks its motion and its frames (all
// there, not blank, not frozen). Frames, an MP4, a GIF and a contact sheet per shot, and summary.json, go to the out folder.
// DRY=1 runs the same shots in Node on the package, without a browser, to check them before a GPU turn.
//   usage: node tools/docs/record-snow-session.mjs [out folder]   (default .shots/snow-session; ONLY=<shot> for one;
//   LOAD_ONLY=1 times the page's load to ready, a minute at most, without recording)
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DEMO = process.env.DEMOS ?? fileURLToPath(new URL('../../docs/demos/', import.meta.url));
const out = resolve(process.argv[2] ?? '.shots/snow-session');
const FPS = 15, DT = 1 / FPS, SIZE = { width: 960, height: 540 }, LOAD = 5 * 60 * 1000, TIMEOUT = 2 * 60 * 1000, FRAME = 10 * 1000;
// Cameras in the armature's space (Blender's axes, metres), so they ride with Snow: side-on, low on the left foot, and
// on the face.
const SIDE = { camera: { position: [3, 0, 0.9], target: [0, 0, 0.6], up: [0, 0, 1], fov: 0.7 } };
const FOOT = { camera: { position: [1.1, -0.2, 0.25], target: [0, 0, 0.1], up: [0, 0, 1], fov: 0.6 } };
const FACE = { camera: { position: [1.2, -0.6, 1.45], target: [0, 0, 1.4], up: [0, 0, 1], fov: 0.5 } };

// The slope (Babylon x 3 to 9) ends in a drop: a shot on it stops before its top, so Snow never leaves the ground.
// A shot: `place` [x, z, facing x, facing z] in Babylon's axes (the package's root maps Blender's (x, y) to (x, z)),
// `moves` [seconds, vx, vz] held until the next (m/s, world), `view` the follow camera's yaw from behind, pitch and
// distance or a camera in the armature's space, `query` added to the page's, `at` frame: code run then, `summit` a
// point (x, z) of the highest ground the shot crosses, and `expect` its motion checks; `summitMiss` is how far the
// climb falls from that ground's height above the start, read from the scene in the shot.
const SHOTS = [
  { name: 'gaits', seconds: 11, box: [0.25, 0.9], moves: [[0, 0, 0], [1, 0, 1.4], [4, 0, 3.5], [7, -6, 0], [9.5, 0, 0]], view: { yaw: 0, ease: 2 },
    expect: { travelled: [15, 60], fastest: [5, 9] } },
  { name: 'turn', seconds: 5, box: [0.25, 0.9], at: { 15: 'turn(1, 0)', 45: 'turn(0, -1)' }, view: { yaw: 0.6, ease: 2 },
    expect: { travelled: [0, 0.4], turned: [2.5, 3.5] } },
  { name: 'slope-side', seconds: 9, place: [2.5, 0, 1, 0], moves: [[0, 0, 0], [0.5, 1.2, 0], [5.5, 0, 0], [7, -1.2, 0]],
    view: SIDE, box: [0.4, 1], expect: { climbed: [0.5, 2], aloft: [0, 0.05], travelled: [2, 8] } },
  { name: 'slope-feet', seconds: 6, place: [2.5, 0, 1, 0], moves: [[0, 0, 0], [0.5, 1.2, 0], [5.3, 0, 0]],
    view: FOOT, expect: { climbed: [0.5, 2], aloft: [0, 0.05] } },
  { name: 'steps-side', seconds: 8, place: [-6, 1, 0, 1], moves: [[0, 0, 0], [0.5, 0, 1.2], [6, 0, 0]],
    summit: [-6, 3.6], view: SIDE, box: [0.4, 1], expect: { summitMiss: [0, 0.02], aloft: [0, 0.05] } },
  { name: 'steps-feet', seconds: 6, place: [-6, 1, 0, 1], moves: [[0, 0, 0], [0.5, 0, 1.2]],
    summit: [-6, 3.6], view: FOOT, expect: { summitMiss: [0, 0.02], aloft: [0, 0.05] } },
  { name: 'face-ramp', seconds: 7, place: [2.5, 0, 1, 0], moves: [[0, 0, 0], [0.5, 1, 0], [6, 0, 0]],
    view: FACE, expect: { climbed: [0.5, 2], aloft: [0, 0.05] } },
  { name: 'take-over', seconds: 14, box: [0.2, 0.9], query: 'act=0', at: { 120: 'tap()' }, moves: [[0, 0, 0], [8, 0, 1.4]], view: { ease: 2 },
    expect: { lag: [0, 0.5], travelled: [3, 12], talking: true } },
];

/** Page-side helpers, the same in the browser and in the dry run: the shot's input, place, turns and the tap. */
const HELPERS = `
  const { hero } = window.demo, V = hero.movement.position.constructor, m = new V(), summit = window.summit;
  // Measured from where the shot starts, once Snow is placed.
  const begin = () => {
    const p = hero.movement.position, f = hero.movement.facing;
    window.session = { ...window.session, start: p.clone(), top: p.y, yaw: Math.atan2(f.x, f.z), fastest: 0, turned: 0, lag: NaN, aloft: 0,
      summit: summit && (hero.movement.ground(summit[0], summit[1])?.height ?? NaN) };
  };
  const turn = (x, z) => hero.turnTo(hero.movement.position.add(new V(x, 0, z)));
  // The tap: how far the acting got, then the take-over.
  const tap = () => {
    const acting = hero.layers.find((l) => l.name === 'face')?.source;
    window.session.lag = window.demo.clock - (acting?.time ?? 0);
    window.demo.step(0, { takeOver: true });
  };
  window.session = { at: { turn, tap }, begin };
  begin();`;

/** The page's state after each frame, for the checks. */
const SAMPLE = `(() => {
  const { hero } = window.demo, s = window.session, v = hero.movement.velocity, p = hero.movement.position;
  s.fastest = Math.max(s.fastest, Math.hypot(v.x, v.z));
  s.top = Math.max(s.top, p.y);
  const under = hero.movement.ground(p.x, p.z);
  if (under) s.aloft = Math.max(s.aloft, Math.abs(p.y - under.height));
  const yaw = Math.atan2(hero.movement.facing.x, hero.movement.facing.z);
  s.turned += Math.abs(Math.atan2(Math.sin(yaw - s.yaw), Math.cos(yaw - s.yaw)));
  s.yaw = yaw;
  s.nan = s.nan || hero.pose.some(Number.isNaN);
  return null;
})()`;

/**
 * Whether the character is drawn whole this frame: each of its meshes that is meant to show (enabled and visible
 * when the shot starts, under the armature or skinned by it) and lies in the camera's view must have been drawn
 * (activated this frame, its material ready, non-zero bounds); and the screen box of all of them, as a share of
 * the view's height. Names of the meshes not drawn accumulate in the session.
 */
const DRAWN = `(() => {
  const { hero, blend } = window.demo, scene = blend.scene, s = window.session, camera = scene.activeCamera;
  s.meshes ??= scene.meshes.filter((m) => m.isEnabled() && m.isVisible && (m.isDescendantOf(hero.node) || (m.skeleton && m.skeleton.id.split(' ')[0] === hero.armature)));
  s.undrawn ??= new Set();
  const planes = scene.frustumPlanes, size = scene.getEngine().getRenderHeight(), viewport = camera.viewport.toGlobal(scene.getEngine().getRenderWidth(), size);
  const transform = scene.getTransformMatrix(), V = hero.movement.position.constructor;
  let top = Infinity, bottom = -Infinity;
  for (const m of s.meshes) {
    const bounds = m.getBoundingInfo();
    if (!m.isInFrustum(planes)) continue;
    const drawn = m._renderId === scene.getRenderId() && m.isReady(true) && bounds.boundingBox.extendSizeWorld.length() > 1e-3;
    if (!drawn) s.undrawn.add(m.name);
    for (const corner of bounds.boundingBox.vectorsWorld) {
      const p = V.Project(corner, hero.node.getWorldMatrix().constructor.IdentityReadOnly, transform, viewport);
      top = Math.min(top, p.y); bottom = Math.max(bottom, p.y);
    }
  }
  const box = Number.isFinite(top) ? (Math.min(bottom, size) - Math.max(top, 0)) / size : 0;
  s.boxes ??= [];
  s.boxes.push(box);
  // A camera following from behind sees Snow's back: count the samples it is in front of Snow instead.
  const toCamera = camera.position.subtract(hero.movement.position), facing = hero.movement.facing;
  s.samples = (s.samples ?? 0) + 1;
  if (toCamera.x * facing.x + toCamera.z * facing.z > 0) s.inFront = (s.inFront ?? 0) + 1;
  return null;
})()`;

/** The motion checks' measures, from the page. */
const MEASURE = `(() => {
  const { hero, clock } = window.demo, s = window.session, p = hero.movement.position;
  const acting = hero.layers.find((l) => l.name === 'face')?.source;
  return { travelled: Math.hypot(p.x - s.start.x, p.z - s.start.z), fastest: s.fastest, climbed: s.top - s.start.y, turned: s.turned,
    undrawn: [...(s.undrawn ?? [])], inFront: (s.inFront ?? 0) / (s.samples || 1), boxLow: Math.min(...(s.boxes ?? [0])), boxHigh: Math.max(...(s.boxes ?? [0])), lag: s.lag, aloft: s.aloft, summitMiss: Math.abs(s.top - s.summit), talking: !!acting && hero.layers.find((l) => l.name === 'face').source === acting, nan: !!s.nan, clock };
})()`;

/** Sets the shot's input from its moves, and its start place. */
const setup = (shot) => `window.summit = ${JSON.stringify(shot.summit ?? null)};
${HELPERS}
  const moves = ${JSON.stringify(shot.moves ?? [[0, 0, 0]])};
  hero.input = () => { const [, x, z] = moves.filter(([t]) => t <= window.demo.clock).at(-1); return { move: m.set(x, 0, z) }; };
  ${shot.place ? `hero.movement.place(new V(${shot.place[0]}, 0, ${shot.place[1]}), new V(${shot.place[2]}, 0, ${shot.place[3]}), 0.05);` : ''}`;

/** What failed of a shot's motion checks. */
function failures(shot, measured) {
  const found = [];
  if (measured.nan) found.push('a bone became NaN');
  if (measured.undrawn?.length) found.push(`not drawn: ${measured.undrawn.join(', ')}`);
  // Turns take the camera a moment to follow round: a tenth of the shot in front of Snow is allowed.
  if (shot.view?.yaw === 0 && !process.env.DRY && measured.inFront > 0.1) found.push(`the camera behind Snow was in front of it ${(measured.inFront * 100).toFixed(0)}% of the shot`);
  // The screen box needs drawn frames: not in the dry run.
  if (shot.box && !process.env.DRY && !(measured.boxLow >= shot.box[0] && measured.boxHigh <= shot.box[1])) found.push(`screen box ${measured.boxLow?.toFixed(2)} to ${measured.boxHigh?.toFixed(2)} of the view's height, wanted ${JSON.stringify(shot.box)}`);
  for (const [key, want] of Object.entries(shot.expect)) {
    const got = measured[key];
    if (Array.isArray(want) ? !(got >= want[0] && got <= want[1]) : got !== want) found.push(`${key} ${typeof got === 'number' ? got.toFixed(2) : got}, wanted ${JSON.stringify(want)}`);
  }
  return found;
}

/** Runs `work` or fails after `ms`. */
const timed = (work, ms, name) => Promise.race([work, new Promise((_, fail) => setTimeout(() => fail(new Error(`${name}: timed out after ${ms / 1000} s`)), ms))]);

/** The frames' checks: all there, none blank, not all the same. */
function frameFailures(dir, expected, ffmpeg) {
  const frames = readdirSync(dir).filter((f) => f.endsWith('.png')).sort();
  const found = frames.length === expected ? [] : [`${frames.length} frames, wanted ${expected}`];
  const stats = frames.filter((_, i) => i % 15 === 0).map((f) => {
    const raw = execFileSync(ffmpeg, ['-loglevel', 'error', '-i', join(dir, f), '-vf', 'scale=32:18,format=gray', '-f', 'rawvideo', '-']);
    const mean = raw.reduce((a, b) => a + b, 0) / raw.length;
    return { mean, sum: raw.reduce((a, b, i) => a + b * ((i % 7) + 1), 0) };
  });
  if (stats.some((s) => s.mean < 4 || s.mean > 251)) found.push('a blank frame');
  if (stats.length > 2 && new Set(stats.map((s) => s.sum)).size === 1) found.push('frozen: every sampled frame the same');
  return found;
}

/** The shots on the page in Chromium, frame by frame. */
async function record(shots) {
  const { chromium } = await import('../../tests/e2e/app.mjs');
  const { ffmpeg } = await import('../media.mjs');
  const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png', '.jpg': 'image/jpeg', '.mp3': 'audio/mpeg' };
  const server = createServer((req, res) => {
    const path = join(DEMO, decodeURIComponent(req.url.split('?')[0]));
    const file = existsSync(path) && statSync(path).isDirectory() ? join(path, 'index.html') : path;
    if (!existsSync(file)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(readFileSync(file));
  }).listen(0);
  // The dialogue may play without a gesture, so waitForSound does not hold the first frame.
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const results = [];
  for (const shot of shots) {
    const dir = join(out, shot.name), errors = [];
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const page = await browser.newPage({ viewport: SIZE });
    page.on('pageerror', (e) => errors.push(e.message));
    try {
      // The load: the page's character made, then its scene ready to draw (a while at most, as the page bounds it).
      const start = performance.now();
      // The page's module awaits the whole package before its load event: wait for it below, not for the event.
      await page.goto(`http://localhost:${server.address().port}/character-controller/?step${shot.query ? `&${shot.query}` : ''}`, { waitUntil: 'commit' });
      await page.waitForFunction(() => window.demo?.step, null, { timeout: LOAD });
      const made = (performance.now() - start) / 1000;
      await page.waitForFunction(() => window.demo.blend.scene.isReady(true), null, { timeout: LOAD, polling: 100 }).catch(() => {});
      const load = { made, ready: (performance.now() - start) / 1000 };
      console.log(shot.name, `loaded in ${load.made.toFixed(1)} s, ready in ${load.ready.toFixed(1)} s`);
      if (process.env.LOAD_ONLY) { results.push({ shot: shot.name, ok: load.ready < 60, found: load.ready < 60 ? [] : [`ready in ${load.ready.toFixed(1)} s, over a minute`], load }); await page.close(); continue; }
      await timed((async () => {
        await page.addStyleTag({ content: '#help{display:none}' });
        await page.evaluate(setup(shot));
        for (let k = 0; k < 6; k++) await page.evaluate(([dt, view]) => window.demo.step(dt, view), [DT, shot.view]);
        await page.evaluate(() => window.session.begin());
        const frames = Math.round(shot.seconds * FPS), times = { step: [], draw: [], shot: [] };
        const clock = (list, from) => list.push(performance.now() - from);
        for (let k = 0; k < frames; k++) {
          let from = performance.now();
          if (shot.at?.[k]) await page.evaluate(`window.session.at.${shot.at[k]}`);
          await page.evaluate(([dt, view]) => window.demo.step(dt, view), [DT, shot.view]);
          await page.evaluate(SAMPLE);
          clock(times.step, from);
          from = performance.now();
          // Drawn again once ready, a while at most: a material that fails to compile never gets ready.
          // Once per shot, a scene that never gets ready names what holds it; after that a frame waits briefly.
          const unready = await page.evaluate(async (first) => {
            const { scene } = window.demo.blend;
            for (let k = 0; k < (first ? 100 : 5) && !scene.isReady(true); k++) await new Promise((done) => setTimeout(done, 20));
            scene.render();
            return first && !scene.isReady(true) ? scene.meshes.filter((m) => m.isEnabled() && m.isVisible && !m.isReady(true)).map((m) => `${m.name} (${m.material?.name ?? 'no material'})`).slice(0, 12) : null;
          }, k === 0);
          if (unready) console.log(`${shot.name}: not ready: ${unready.join(', ') || 'no mesh (a render target or post-process)'}`);
          if (k % 5 === 0) await page.evaluate(DRAWN);
          clock(times.draw, from);
          from = performance.now();
          await page.screenshot({ path: join(dir, `${String(k).padStart(4, '0')}.png`) });
          clock(times.shot, from);
          const frame = times.step.at(-1) + times.draw.at(-1) + times.shot.at(-1);
          if (frame > FRAME) throw new Error(`${shot.name}: frame ${k} took ${(frame / 1000).toFixed(1)} s`);
        }
        const median = (list) => Math.round([...list].sort((a, b) => a - b)[list.length >> 1]);
        const perFrame = { step: median(times.step), draw: median(times.draw), screenshot: median(times.shot) };
        console.log(shot.name, `ms a frame: step ${perFrame.step}, draw ${perFrame.draw}, screenshot ${perFrame.screenshot}`);
        const measured = await page.evaluate(MEASURE);
        const found = [...errors, ...failures(shot, measured), ...frameFailures(dir, frames, ffmpeg)];
        execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', join(dir, '%04d.png'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '26', join(out, `${shot.name}.mp4`)]);
        execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', join(dir, '%04d.png'), '-vf', `fps=1,scale=320:-1,tile=4x${Math.ceil(shot.seconds / 4)}`, '-frames:v', '1', join(out, `${shot.name}-sheet.png`)]);
        execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', join(dir, '%04d.png'), '-vf', 'fps=10,scale=480:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96[p];[b][p]paletteuse=dither=bayer:bayer_scale=4', join(out, `${shot.name}.gif`)]);
        results.push({ shot: shot.name, ok: !found.length, found, measured, load, perFrame });
      })(), TIMEOUT + shot.seconds * FPS * 2000, shot.name);
    } catch (e) {
      results.push({ shot: shot.name, ok: false, found: [String(e.message ?? e)] });
    }
    await page.close();
    console.log(results.at(-1).ok ? 'ok  ' : 'FAIL', shot.name, results.at(-1).found.join('; '));
  }
  await browser.close();
  server.close();
  return results;
}

/** The shots in Node on the package (NullEngine, no drawing): their setup, input, places, take-over and motion. */
async function dryRun(shots) {
  const { NullEngine } = await import('@babylonjs/core');
  const base = pathToFileURL(join(DEMO, 'character-controller/')).href;
  const { load } = await import(`${base}world/scene.js`);
  const { createSnow } = await import(`${base}snow.js`);
  const results = [];
  for (const shot of shots) {
    try {
      await timed((async () => {
        const blend = await load(new NullEngine());
        const { hero, act } = createSnow(blend, { manual: true, input: null });
        let clock = 0, takeOver = null, actAt = shot.query?.startsWith('act=') ? Number(shot.query.slice(4)) : null;
        const step = (dt, view = {}) => {
          clock += dt;
          if (actAt !== null && clock >= actAt) { takeOver = act(); actAt = null; }
          if (view.takeOver && takeOver) { takeOver(); takeOver = null; }
          hero.update(dt);
        };
        globalThis.window = { demo: { blend, hero, step, get clock() { return clock; } } };
        new Function(setup(shot))();
        for (let k = 0; k < 6; k++) step(DT);
        window.session.begin();
        for (let k = 0; k < Math.round(shot.seconds * FPS); k++) {
          if (shot.at?.[k]) new Function(`window.session.at.${shot.at[k]}`)();
          step(DT, shot.view);
          new Function(`return ${SAMPLE}`)();
        }
        const measured = new Function(`return ${MEASURE}`)(), found = failures(shot, measured);
        results.push({ shot: shot.name, ok: !found.length, found, measured });
        blend.dispose?.();
      })(), TIMEOUT, shot.name);
    } catch (e) {
      results.push({ shot: shot.name, ok: false, found: [String(e.message ?? e)] });
    }
    console.log(results.at(-1).ok ? 'ok  ' : 'FAIL', shot.name, results.at(-1).found.join('; '), JSON.stringify(results.at(-1).measured ?? {}));
  }
  return results;
}

const chosen = SHOTS.filter((shot) => !process.env.ONLY || process.env.ONLY.split(',').includes(shot.name));
mkdirSync(out, { recursive: true });
const results = process.env.DRY ? await dryRun(chosen) : await record(chosen);
writeFileSync(join(out, process.env.DRY ? 'dry-run.json' : 'summary.json'), JSON.stringify(results, null, 2));
console.log(`${results.filter((r) => r.ok).length} of ${results.length} shots ok; ${join(out, process.env.DRY ? 'dry-run.json' : 'summary.json')}`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
