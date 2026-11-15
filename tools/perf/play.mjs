// The app in vite's dev server and Play in its Game area, for the perf tools (play-cost.mjs, gpu-profile.mjs).
import { execFileSync } from 'node:child_process';
import { createServer } from 'vite';

// The app's URL: E2E_URL, else a dev server started here (`close` stops it). Babylon's WebGPU compilers are fetched into
// public/webgpu/ first, as npm run dev does.
export async function appServer(port) {
  if (process.env.E2E_URL) return { url: process.env.E2E_URL, close() {} };
  execFileSync(process.execPath, ['scripts/babylon-assets.mjs'], { stdio: 'ignore' });
  const server = await createServer({ logLevel: 'error', server: { port, strictPort: false } });
  await server.listen();
  return { url: server.resolvedUrls.local[0], close: () => server.close() };
}

// Opens the Game area on the given modifier stack (RENDER or VIEWPORT) and presses Play; resolves true once the run has
// drawn a frame of its own, false when `cap` ms pass first. Play's own promise is kept in the page (globalThis.__play).
export async function play(app, { stack = 'RENDER', cap }) {
  await app.bylonder((b, stack) => { b.dock.show('game'); b.modules.bpyRna.blendData().scenes[0].bylonder.export_evaluation = stack; }, stack);
  await app.settled();
  await app.bylonder((b) => {
    globalThis.__play = { state: 'running' };
    Promise.resolve(b.runOperator('bylonder.game_play')).then(() => { globalThis.__play.state = 'resolved'; }, (error) => { globalThis.__play = { state: 'rejected', error: error?.stack }; });
  });
  return app.until((b) => b.game?.blend?.scene.getEngine().frameId > 0, null, cap).then(() => true, () => false);
}

// The game's frame rate over `ms`, and the engine it draws with.
export const gameFps = (app, ms = 10000) => app.bylonder(async (b, ms) => {
  const engine = b.game.blend.scene.getEngine(), from = engine.frameId, at = performance.now();
  await new Promise((resolve) => setTimeout(resolve, ms));
  return `${((engine.frameId - from) / ((performance.now() - at) / 1000)).toFixed(2)} on ${engine.isWebGPU ? 'WebGPU' : 'WebGL 2'}`;
}, ms);

// Prints the page's console errors and warnings and its uncaught errors as they come, with the seconds since `t0()`.
export function logPage(page, since) {
  page.on('console', (message) => { if (['error', 'warning'].includes(message.type())) console.log(since(), `console.${message.type()}`, message.text().slice(0, 600)); });
  page.on('pageerror', (error) => console.log(since(), 'pageerror', error.stack?.slice(0, 1200)));
}
