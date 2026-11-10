// A JavaScript export's package written to a folder as the zip holds it, with the runtime and the folders of Blender's
// code it loads from src, and its scene.js imported: @babylonjs/core resolves to the installed package, as an
// import map maps it in a page.
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gplFiles, packagedRuntime, packageOverrides, packageRuntime } from '../src/io_scene_babylon/runtime-files.js';

const CORE = JSON.stringify(import.meta.resolve('@babylonjs/core'));
const src = (path) => readFileSync(new URL(`../src/${path}`, import.meta.url));

// The package's files by path, as export.js zips them.
export function packageFiles(files) {
  const withRuntime = { ...files, ...Object.fromEntries(packageRuntime(files).map(([path, name]) => [path, packagedRuntime(String(src(`io_scene_babylon/runtime/${name}`)))])) };
  return { ...withRuntime, ...Object.fromEntries(packageOverrides(withRuntime).map(([path, from]) => [path, src(from)])),
    ...Object.fromEntries(gplFiles(files).map(([path, from]) => [path, src(from)])) };
}

// `dir`: where to write it (default a new temporary folder).
export function writePackage(files, dir = mkdtempSync(join(tmpdir(), 'bylonder-package-'))) {
  const all = packageFiles(files);
  for (const [path, data] of Object.entries(all)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), /\.m?js$/.test(path) ? String(data).replace(/(['"])@babylonjs\/core\1/g, CORE) : data);
  }
  return { dir, url: pathToFileURL(join(dir, 'scene.js')).href, remove: () => rmSync(dir, { recursive: true }) };
}
