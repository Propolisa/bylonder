// The time from Play in the Game area to the game drawing, in the dev build (vite's dev server) or another served app
// (E2E_URL), then the game's frame rate, with a CPU profile of the page over it when a file is given. CAP=minutes
// (default 20) stops there and reports where the run stands; STACK=VIEWPORT plays the Viewport modifier stack (the Game
// header's choice), else Render; E2E_ENGINE=webgpu draws the app with WebGPU. The page's console messages and errors
// print as they come.
//   usage: node tools/perf/play-cost.mjs <example> <node> [profile.cpuprofile]
// The example opens by its #example= link, so its .blend must be in examples/<example>/ while this runs (Snow's is not
// in git: copy it in, and out again before npm test). Nothing may write into the served tree while it runs.
import { writeFileSync } from 'node:fs';
import { createServer } from 'vite';
import { chromium, openApp } from '../../tests/e2e/app.mjs';

const [example, node, profileOut] = process.argv.slice(2);
const cap = Number(process.env.CAP ?? 20) * 60000;
const server = process.env.E2E_URL ? null : await createServer({ logLevel: 'error', server: { port: 4330, strictPort: false } });
if (server) await server.listen();
const url = process.env.E2E_URL ?? server.resolvedUrls.local[0];
const browser = await chromium.launch();
const t = () => performance.now();
let t0 = t();
const app = await openApp(browser, url, { link: example, node });
console.log('OPEN', Math.round(t() - t0), 'ms');
const since = () => `${Math.round((t() - t0) / 1000)} s`;
app.page.on('console', (message) => { if (['error', 'warning'].includes(message.type())) console.log(since(), `console.${message.type()}`, message.text().slice(0, 600)); });
app.page.on('pageerror', (error) => console.log(since(), 'pageerror', error.stack?.slice(0, 1200)));
await app.bylonder((b, stack) => { b.dock.show('game'); b.modules.bpyRna.blendData().scenes[0].bylonder.export_evaluation = stack; }, process.env.STACK ?? 'RENDER');
await app.settled();
const cdp = profileOut && await app.context.newCDPSession(app.page);
if (cdp) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 5000 }); await cdp.send('Profiler.start'); }
t0 = t();
// Play's own promise, kept in the page: how it ended, if it did.
await app.bylonder((b) => {
  globalThis.__play = { state: 'running' };
  Promise.resolve(b.runOperator('bylonder.game_play')).then(() => { globalThis.__play.state = 'resolved'; }, (error) => { globalThis.__play = { state: 'rejected', error: error?.stack }; });
});
// Playing once the run has drawn a frame of its own.
const done = await app.until((b) => b.game?.blend?.scene.getEngine().frameId > 0, null, cap).then(() => true, () => false);
console.log(done ? `PLAY ${Math.round(t() - t0)} ms` : `CAPPED at ${cap / 60000} min`);
if (done) console.log('FPS', await app.bylonder(async (b) => {
  const engine = b.game.blend.scene.getEngine(), from = engine.frameId, at = performance.now();
  await new Promise((resolve) => setTimeout(resolve, 10000));
  return `${((engine.frameId - from) / ((performance.now() - at) / 1000)).toFixed(2)} on ${engine.isWebGPU ? 'WebGPU' : 'WebGL 2'}`;
}));
else console.log('STATE', await app.bylonder(async (b) => {
  const scene = globalThis.__playScene, at = performance.now();
  await new Promise((resolve) => setTimeout(resolve, 50));
  const waiting = scene?.meshes.filter((m) => m.isEnabled() && m.isVisible && !m.isReady(true)).map((m) => `${m.name} (${m.material?.name})`).slice(0, 12);
  return JSON.stringify({ play: globalThis.__play, step: globalThis.__playStep, log: globalThis.__playLog?.slice(-20), timer50: Math.round(performance.now() - at), ready: scene?.isReady(true), waiting, blend: !!b.game?.blend }, null, 1);
}).catch((error) => `no answer: ${error.message}`));
if (cdp) writeFileSync(profileOut, JSON.stringify((await cdp.send('Profiler.stop')).profile));
await browser.close();
await server?.close();
process.exit(0);
