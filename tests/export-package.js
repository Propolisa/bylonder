// A JavaScript export's package written to a folder as the zip holds it, with the runtime from src, and its scene.js
// imported: @babylonjs/core resolves to the installed package, as an import map maps it in a page.
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { RUNTIME_FILES } from '../src/io_scene_babylon/runtime-files.js';

const CORE = JSON.stringify(import.meta.resolve('@babylonjs/core'));

export function writePackage(files) {
  const dir = mkdtempSync(join(tmpdir(), 'bylonder-package-'));
  const all = { ...files, ...Object.fromEntries(RUNTIME_FILES.map((name) => [`bylonder/${name}`, readFileSync(new URL(`../src/io_scene_babylon/runtime/${name}`, import.meta.url))])) };
  for (const [path, data] of Object.entries(all)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), /\.m?js$/.test(path) ? String(data).replaceAll("'@babylonjs/core'", CORE) : data);
  }
  return { dir, url: pathToFileURL(join(dir, 'scene.js')).href, remove: () => rmSync(dir, { recursive: true }) };
}

