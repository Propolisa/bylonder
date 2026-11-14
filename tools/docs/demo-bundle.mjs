// A demo game's page (docs/demos/<game>/: index.html, its modules, its packages in folders) bundled with Babylon.js as
// File > Export > JavaScript's Bundle bundles a package (bundle.js), so the published page loads a few files instead
// of Babylon's hundreds of modules one by one.
//   usage: node tools/docs/demo-bundle.mjs <game> <folder>  (writes the bundled page there, to serve it locally)
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { bundlePage } from '../../src/io_scene_babylon/bundle.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const CORE = join(ROOT, 'node_modules/@babylonjs/core');

const filesIn = (dir) => Object.fromEntries(readdirSync(dir, { recursive: true }).map((path) => path.replaceAll('\\', '/'))
  .filter((path) => statSync(join(dir, path)).isFile()).map((path) => [path, readFileSync(join(dir, path))]));

/** The demo pages that are games: their own modules around packages. */
export const demoGames = () => readdirSync(join(ROOT, 'docs/demos')).filter((name) => statSync(join(ROOT, 'docs/demos', name, 'game.js'), { throwIfNoEntry: false }));

/** The files of the game page in `dir`, by path, its modules bundled. */
export async function bundleDemo(dir) {
  const files = filesIn(dir), text = (path) => String(files[path]);
  const pinned = /@babylonjs\/core@([\d.]+)\//.exec(text('index.html'))?.[1];
  const installed = JSON.parse(readFileSync(join(CORE, 'package.json'), 'utf8')).version;
  if (pinned !== installed) throw Error(`${dir}: the page pins Babylon.js ${pinned}, the installed one is ${installed}`);
  const folder = (path) => path.includes('/') && `${path.split('/')[0]}/`;
  const packages = {};
  for (const [path, data] of Object.entries(files)) {
    const at = folder(path);
    if (at && `${at}scene.js` in files) (packages[at] ??= {})[path.slice(at.length)] = /\.(js|json)$/.test(path) ? String(data) : data;
  }
  // run.js is the debug recorder, copied beside the page in development and loaded only on ?debug.
  const own = Object.fromEntries(Object.keys(files).filter((path) => !folder(path) && path.endsWith('.js') && path !== 'run.js').map((path) => [path, text(path)]));
  const missing = Object.values(own).flatMap((code) => [...code.matchAll(/'\.\/([\w-]+\/)scene\.js'/g)].map((m) => m[1])).filter((at) => !packages[at]);
  if (missing.length) throw Error(`${dir}: no package in ${missing.join(', ')}; npm run module fetches the demo packages`);
  const others = Object.fromEntries(Object.entries(files).filter(([path]) => !(folder(path) in packages) && !(path in own)));
  const bundled = await bundlePage(packages, { esbuild, page: { files: own, entry: 'game.js' }, babylon: (path) => readFileSync(join(CORE, path), 'utf8') });
  return { ...others, ...bundled };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [game, out] = process.argv.slice(2);
  for (const [path, data] of Object.entries(await bundleDemo(join(ROOT, 'docs/demos', game)))) {
    mkdirSync(dirname(join(out, path)), { recursive: true });
    writeFileSync(join(out, path), data);
  }
}
