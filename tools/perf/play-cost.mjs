// The time from Play in the Game area to the game drawing, in the dev build (vite's dev server) or another served app
// (E2E_URL), with each export step the Game header shows and when, and a CPU profile of the page over it when a file is
// given: the main thread's time by function, as Node's --cpu-prof gives. CAP=minutes (default 20) saves the profile so
// far and stops there; STACK=VIEWPORT plays the Viewport modifier stack (the Game header's choice), else Render.
//   usage: node tools/perf/play-cost.mjs <example> <node> [profile.cpuprofile]
// The example opens by its #example= link, so its .blend must be in examples/<example>/ while this runs (Snow's is not
// in git: copy it in, and out again before npm test). Nothing may write into the served tree while it runs.
import { writeFileSync } from 'node:fs';
import { createServer } from 'vite';
import { chromium, openApp } from '../../tests/e2e/app.mjs';

const [example, node, profileOut] = process.argv.slice(2);
const cap = Number(process.env.CAP ?? 20) * 60000;
const server = process.env.E2E_URL ? null : await createServer({ logLevel: 'warn', server: { port: 4330, strictPort: false } });
if (server) await server.listen();
const url = process.env.E2E_URL ?? server.resolvedUrls.local[0];
const browser = await chromium.launch();
const t = () => performance.now();
let t0 = t();
const app = await openApp(browser, url, { link: example, node });
console.log('OPEN', Math.round(t() - t0), 'ms');
await app.bylonder((b, stack) => { b.dock.show('game'); b.modules.bpyRna.blendData().scenes[0].bylonder.export_evaluation = stack; }, process.env.STACK ?? 'RENDER');
await app.settled();
const cdp = profileOut && await app.context.newCDPSession(app.page);
if (cdp) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 5000 }); await cdp.send('Profiler.start'); }
t0 = t();
await app.bylonder((b) => { b.runOperator('bylonder.game_play'); });
// The header's status as it changes, read off the page's DOM.
const header = app.locator('#game-section');
let shown = '';
const watch = setInterval(async () => {
  const text = await header.innerText({ timeout: 1000 }).catch(() => null);
  const status = text?.split('\n').find((line) => /^(Exporting|Checking|Sampling|Writing|Compressing|Mapping|Playing|Loaded)/.test(line.trim()));
  if (status && status !== shown) console.log(`${Math.round((t() - t0) / 1000)} s`, (shown = status));
}, 2000);
// Playing once the run has drawn a frame of its own.
const playing = app.until((b) => b.game?.blend?.scene.getEngine().frameId > 0, null, cap).then(() => true, () => false);
const done = await playing;
clearInterval(watch);
console.log(done ? `PLAY ${Math.round(t() - t0)} ms` : `CAPPED at ${cap / 60000} min, last step: ${shown}`);
// The game's frame rate over 10 s, as it then runs.
if (done) console.log('FPS', await app.bylonder(async (b) => {
  const engine = b.game.blend.scene.getEngine(), from = engine.frameId, at = performance.now();
  await new Promise((resolve) => setTimeout(resolve, 10000));
  return ((engine.frameId - from) / ((performance.now() - at) / 1000)).toFixed(2);
}));
if (cdp) writeFileSync(profileOut, JSON.stringify((await cdp.send('Profiler.stop')).profile));
if (app.errors.length) console.log('ERRORS', app.errors.slice(0, 10).join('\n'));
await browser.close();
await server?.close();
process.exit(0);
