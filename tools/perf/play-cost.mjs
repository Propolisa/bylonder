// The time from Play in the Game area to the game drawing, in the dev build (vite's dev server) or another served app
// (E2E_URL), with a CPU profile of the page over it: the main thread's time by function, as Node's --cpu-prof gives.
//   usage: node tools/perf/play-cost.mjs <example> <node> [profile.cpuprofile]
// The example opens by its #example= link, so its .blend must be in examples/<example>/ while this runs (Snow's is not
// in git: copy it in, and out again before npm test). Nothing may write into the served tree while it runs.
import { writeFileSync } from 'node:fs';
import { createServer } from 'vite';
import { chromium, openApp } from '../../tests/e2e/app.mjs';

const [example, node, profileOut] = process.argv.slice(2);
const server = process.env.E2E_URL ? null : await createServer({ logLevel: 'warn', server: { port: 4330, strictPort: false } });
if (server) await server.listen();
const url = process.env.E2E_URL ?? server.resolvedUrls.local[0];
const browser = await chromium.launch();
const t = () => performance.now();
let t0 = t();
const app = await openApp(browser, url, { link: example, node });
console.log('OPEN', Math.round(t() - t0), 'ms');
await app.bylonder((b) => b.dock.show('game'));
await app.settled();
const cdp = profileOut && await app.context.newCDPSession(app.page);
if (cdp) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 5000 }); await cdp.send('Profiler.start'); }
t0 = t();
await app.bylonder((b) => { b.runOperator('bylonder.game_play'); });
const status = app.locator('#game-section').locator('text=/^(Playing|Play failed.*)$/');
await status.waitFor({ timeout: 3600000 });
console.log('PLAY', Math.round(t() - t0), 'ms', await status.textContent());
if (cdp) writeFileSync(profileOut, JSON.stringify((await cdp.send('Profiler.stop')).profile));
if (app.errors.length) console.log('ERRORS', app.errors.slice(0, 10).join('\n'));
await browser.close();
await server?.close();
process.exit(0);
