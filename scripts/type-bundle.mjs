// Babylon's declarations (its core, and the GUI games draw their screens with) and inkjs's (Ink stories in game code) for the code editor's intelligence (src/workspace/intelligence.js), as public/babylon-types.json:
// each .d.ts under its file:/// URL, with forward slashes on every platform.
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const files = {};
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = path.posix.join(dir, entry.name);
    if (entry.isDirectory()) await walk(file);
    else if (entry.name.endsWith('.d.ts')) files[`file:///${file}`] = await readFile(file, 'utf8');
  }
}
await walk('node_modules/@babylonjs/core');
await walk('node_modules/@babylonjs/gui');
await walk('node_modules/inkjs');
files['file:///node_modules/inkjs/ink.d.mts'] = await readFile('node_modules/inkjs/ink.d.mts', 'utf8');
await mkdir('public', { recursive: true });
await writeFile('public/babylon-types.json', JSON.stringify(files));
console.log(`${Object.keys(files).length} Babylon declaration modules bundled`);
