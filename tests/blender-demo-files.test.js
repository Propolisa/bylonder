// Blender's demo files the splash lists: each with an id that names its copy in the site, a title, its size and an
// https address on Blender's servers (scripts/demo-files.mjs copies them).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { page, files } = JSON.parse(readFileSync(new URL('../src/workspace/blender-demo-files.json', import.meta.url), 'utf8'));
assert.match(page, /^https:\/\/www\.blender\.org\//);
assert.equal(new Set(files.map((f) => f.id)).size, files.length, 'ids are unique');
for (const file of files) {
  assert.match(file.id, /^[a-z0-9_]+$/, file.id);
  assert.ok(file.title && file.size > 0, file.id);
  assert.match(file.url, /^https:\/\/(mirror|download)\.blender\.org\/demo\/.+\.blend$/, file.id);
}
console.log(`blender demo files: ${files.length} listed`);
