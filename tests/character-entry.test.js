// tags: character, behaviors
// The character runtime is entered through api.js: core.js and its effects import each other, and api.js orders them.
// Code elsewhere in src/ that imports core.js (or a module reaching it) first leaves a bundle reading Character before it
// exists ("Cannot access before initialization", the app without its splash). Leaf modules that never reach core.js are
// fine; the effects come after api.js, as an exported package imports them.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const SRC = resolve('src'), CHARACTER = join(SRC, 'io_scene_babylon/runtime/character');
const files = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : /\.(js|vue)$/.test(e.name) ? [join(dir, e.name)] : []));
const importsOf = (file) => [...readFileSync(file, 'utf8').matchAll(/^\s*(?:import|export)\s[^'"]*?from\s*['"](\.[^'"]+)['"]/gm)].map((m) => resolve(dirname(file), m[1]));
const inCharacter = (path) => path.startsWith(CHARACTER + '\\') || path.startsWith(CHARACTER + '/');
const CORE = join(CHARACTER, 'core.js'), API = join(CHARACTER, 'api.js'), EFFECTS = join(CHARACTER, 'effects');
const reaches = (file, target, seen = new Set()) => file === target || (!seen.has(file) && (seen.add(file), importsOf(file).some((next) => reaches(next, target, seen))));

const wrong = [];
for (const file of files(SRC).filter((f) => !inCharacter(f))) {
  const into = importsOf(file).filter(inCharacter), name = relative(SRC, file).replaceAll('\\', '/');
  for (const target of into) {
    if (target === API) continue;
    if (target.startsWith(EFFECTS) ? into.indexOf(API) < 0 || into.indexOf(API) > into.indexOf(target) : reaches(target, CORE))
      wrong.push(`${name} imports ${relative(CHARACTER, target).replaceAll('\\', '/')}`);
  }
}
assert.deepEqual(wrong, [], 'outside the character runtime, import api.js (then its effects), or a module that never reaches core.js');
console.log('character entry: code outside the character runtime enters it through api.js');
