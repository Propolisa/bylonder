// The time from Play in the Game area to the game drawing, in the dev build (vite's dev server) or another served app
// (E2E_URL), then the game's frame rate, with a CPU profile of the page over it when a file is given. CAP=minutes
// (default 20) stops there and reports where the run stands; STACK=VIEWPORT plays the Viewport modifier stack (the Game
// header's choice), else Render; E2E_ENGINE=webgpu draws the app with WebGPU. The page's console messages and errors
// print as they come.
//   usage: node tools/perf/play-cost.mjs <example> <node> [profile.cpuprofile]
// The example opens by its #example= link, so its .blend must be in examples/<example>/ while this runs (Snow's is not
// in git: copy it in, and out again before npm test). Nothing may write into the served tree while it runs.
import { writeFileSync } from 'node:fs';
import { chromium, openApp } from '../../tests/e2e/app.mjs';
import { appServer, play, gameFps, logPage } from './play.mjs';

const [example, node, profileOut] = process.argv.slice(2);
const cap = Number(process.env.CAP ?? 20) * 60000;
const server = await appServer(4330), { url } = server;
const browser = await chromium.launch();
const t = () => performance.now();
let t0 = t();
const app = await openApp(browser, url, { link: example, node });
console.log('OPEN', Math.round(t() - t0), 'ms');
const since = () => `${Math.round((t() - t0) / 1000)} s`;
logPage(app.page, since);
const cdp = profileOut && await app.context.newCDPSession(app.page);
if (cdp) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 5000 }); await cdp.send('Profiler.start'); }
t0 = t();
const done = await play(app, { stack: process.env.STACK ?? 'RENDER', cap });
console.log(done ? `PLAY ${Math.round(t() - t0)} ms` : `CAPPED at ${cap / 60000} min`);
// Three spans of 10 s: the first frames still settle (pipelines, textures).
if (done) for (let i = 0; i < 3; i++) console.log('FPS', await gameFps(app));
else console.log('STATE', await app.bylonder(async (b) => {
  const scene = globalThis.__playScene, at = performance.now();
  await new Promise((resolve) => setTimeout(resolve, 50));
  const waiting = scene?.meshes.filter((m) => m.isEnabled() && m.isVisible && !m.isReady(true)).map((m) => `${m.name} (${m.material?.name})`).slice(0, 12);
  return JSON.stringify({ play: globalThis.__play, step: globalThis.__playStep, log: globalThis.__playLog?.slice(-20), timer50: Math.round(performance.now() - at), ready: scene?.isReady(true), waiting, blend: !!b.game?.blend }, null, 1);
}).catch((error) => `no answer: ${error.message}`));
if (cdp) writeFileSync(profileOut, JSON.stringify((await cdp.send('Profiler.stop')).profile));
await browser.close();
await server.close();
process.exit(0);
