// Views of the module's memory take addresses as unsigned (>>> 0): WebAssembly hands JS its 32-bit values signed, so
// past 2 GiB of memory (a large scene) an address read as is would be negative and the view would throw.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';

const sources = (dir) => readdirSync(dir).flatMap((name) => {
  const path = `${dir}/${name}`;
  if (statSync(path).isDirectory()) return name === 'bl_py' ? [] : sources(path);
  return /\.js$/.test(name) && !/\.gen\.js$|bundle\.js$/.test(name) ? [path] : [];
});
const VIEW = /Array\((?:memory|buffer|[\w.]*memory\.buffer), /g;
// The view's offset argument: the text up to the comma or parenthesis that ends it.
const offsetAt = (text, start) => {
  let depth = 0, i = start;
  for (; i < text.length; i++) {
    if ('([{'.includes(text[i])) depth++;
    else if (')]}'.includes(text[i])) { if (!depth--) break; }
    else if (text[i] === ',' && !depth) break;
  }
  return text.slice(start, i).trim();
};
const signed = sources('src').flatMap((file) => {
  const text = readFileSync(file, 'utf8');
  return [...text.matchAll(VIEW)].map((m) => offsetAt(text, m.index + m[0].length))
    .filter((offset) => !/>>> 0\)?$|^\d+$/.test(offset) && !/^\(\w+ >>> 0\) \+/.test(offset) && !/^pointerOf\(/.test(offset))
    .map((offset) => `${file}: ${offset}`);
});
assert.deepEqual(signed, [], 'module memory views with a signed address');
console.log('module pointers: ok');
