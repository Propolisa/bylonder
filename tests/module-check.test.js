// A dev server whose Blender module was fetched for another source tree says so (vite.config.js moduleCheck), from
// scripts/module.mjs staleModule: a key other than the tree's is stale, the tree's own is not, and a local build (no
// key) is left alone.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { staleModule } from '../scripts/module.mjs';

const dir = mkdtempSync(join(tmpdir(), 'module-key-')), mark = join(dir, 'bmesh.wasm.key');
const own = execFileSync('node', ['scripts/module.mjs', 'key'], { encoding: 'utf8' }).trim();
writeFileSync(mark, 'module-0000000000000000000000000000000000000000');
assert.equal(staleModule(mark), 'module-0000000000000000000000000000000000000000', 'another tree\'s module is stale');
writeFileSync(mark, own);
assert.equal(staleModule(mark), null, 'the tree\'s own is not');
rmSync(dir, { recursive: true });
assert.equal(staleModule(mark), null, 'a local build, without a key, is left alone');
console.log('Module check: a module fetched for another source tree is reported, the tree\'s own and a local build are not');
