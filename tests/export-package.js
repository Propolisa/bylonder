// A JavaScript export's package written to a folder as the zip holds it, with the runtime and the folders of Blender's
// code it loads from src, and its scene.js imported: @babylonjs/core resolves to the installed package, as an
// import map maps it in a page.
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { appFiles, gplFiles, packagedModules, packagedRuntime, packageOverrides, packageRuntime } from '../src/io_scene_babylon/runtime-files.js';
import { bundlePackage } from '../src/io_scene_babylon/bundle.js';
import { groupEntry } from '../src/io_scene_babylon/runtime/scene-tables.js';

const CORE = import.meta.resolve('@babylonjs/core').replace(/index\.js$/, '');
const src = (path) => readFileSync(new URL(`../src/${path}`, import.meta.url));

// The files the app serves from public/ (scripts/babylon-assets.mjs) that a package ships, empty where the app has
// not fetched them.
const appFile = (path) => { const at = new URL(`../public/${path}`, import.meta.url); return existsSync(at) ? readFileSync(at) : new Uint8Array(); };
const withAppFiles = (files, shipped) => ({ ...shipped, ...Object.fromEntries(appFiles(files).map(([path, from]) => [path, appFile(from)])) });

function modules(files) {
  const withRuntime = { ...files, ...Object.fromEntries(packageRuntime(files).map(([path, name]) => [path, packagedRuntime(String(src(`io_scene_babylon/runtime/${name}`)))])) };
  return packagedModules({ ...withRuntime, ...Object.fromEntries(packageOverrides(withRuntime).map(([path, from]) => [path, src(from)])),
    ...Object.fromEntries(gplFiles(files).map(([path, from]) => [path, src(from)])) });
}

// The package's files by path, as export.js zips them.
export const packageFiles = (files) => withAppFiles(files, modules(files));

// The package's files bundled as export.js bundles them, from the installed Babylon and esbuild.
export async function bundledFiles(files, { minify = true } = {}) {
  return withAppFiles(files, await bundlePackage(modules(files), { minify, esbuild: await import('esbuild-wasm'), babylon: (path) => readFileSync(new URL(path, CORE), 'utf8') }));
}

// `dir`: where to write it (default a new temporary folder).
export function writePackage(files, dir = mkdtempSync(join(tmpdir(), 'bylonder-package-'))) {
  const all = packageFiles(files);
  for (const [path, data] of Object.entries(all)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), /\.m?js$/.test(path) ? String(data).replace(/(['"])@babylonjs\/core(?:\/([^'"]+))?\1/g, (_, quote, path) => JSON.stringify(CORE + (path ?? 'index.js'))) : data);
  }
  return { dir, url: pathToFileURL(join(dir, 'scene.js')).href, remove: () => rmSync(dir, { recursive: true }) };
}

// A table of scene.js (runtime/scene-tables.js) as a list of its entries, `name` its constant's (MATERIALS); its
// animation groups (ANIMATION_GROUPS) as the page assembles them from their tracks.
const tableOf = (files, name) => JSON.parse(new RegExp(`const ${name} = (.*);\n`).exec(files['scene.js'])[1]);
export const sceneTable = (files, name) => (name === 'ANIMATION_GROUPS'
  ? Object.entries(tableOf(files, name)).map(([key, settings]) => groupEntry(key, settings, tableOf(files, 'ANIMATIONS')))
  : Object.values(tableOf(files, name)));
