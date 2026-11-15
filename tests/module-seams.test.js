// tags: module
// The JS and the module it calls cannot drift: every entry point a source file calls on Blender's module (`x.name(`
// where `x` is the module's exports, blenderModule's) is one the installed module exports. A seam written in
// tools/blender-port/wasm/ but not yet in the module (npm run module, or a module build) is named here.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { blenderModule } from '../src/bmesh/bmesh-wasm.js';

const src = fileURLToPath(new URL('../src/', import.meta.url));
const walk = (dir) => readdirSync(dir).flatMap((name) => (statSync(join(dir, name)).isDirectory() ? walk(join(dir, name)) : [join(dir, name)]));
const calls = new Map();
for (const file of walk(src).filter((f) => f.endsWith('.js') && !f.endsWith('.gen.js'))) {
  const text = readFileSync(file, 'utf8');
  if (!/\{ exports: x\b[^}]*\} = blenderModule|exports: x \} = blenderModule|const \{ exports: x/.test(text)) continue;
  for (const [, name] of text.matchAll(/\bx\.([a-z][a-z0-9_]*)\(/g)) (calls.get(name) ?? calls.set(name, new Set()).get(name)).add(file.slice(src.length).replaceAll('\\', '/'));
}
const missing = [...calls].filter(([name]) => typeof blenderModule.exports[name] !== 'function').map(([name, files]) => `${name} (${[...files].join(', ')})`);
assert.ok(calls.size > 50, `found the module's callers (${calls.size} entry points)`);
assert.deepEqual(missing, [], `the module lacks these entry points the JS calls: rebuild or fetch it (npm run module)`);
console.log(`module seams: ${calls.size} entry points the JS calls, all exported`);
