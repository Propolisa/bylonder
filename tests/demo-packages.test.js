// The live demos' exported packages are release assets (scripts/module.mjs, tools/docs/upload-demo-package.mjs): each
// demo the manifest names has its package folder git-ignored, and a package zips, is named by its content, and
// unzips as it was, with the asset it came from marked.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { demoPackages, installPackage } from '../scripts/module.mjs';
import { packageArchive } from '../tools/docs/demo-package.mjs';

// git check-ignore exits 0 for an ignored path, 1 otherwise.
const ignored = (path) => { try { execFileSync('git', ['check-ignore', '-q', '--no-index', path]); return true; } catch { return false; } };
for (const { dir } of [...demoPackages(), { dir: 'docs/demos/character-controller/world' }, { dir: 'docs/demos/basic-character/world' }]) assert.ok(ignored(`${dir}/scene.js`), `${dir} is git-ignored`);
assert.ok(!ignored('docs/demos/character-controller/game.js'), 'the page itself is not');
const root = mkdtempSync(join(tmpdir(), 'demo-package-test-')), from = join(root, 'from'), to = join(root, 'to');
mkdirSync(join(from, 'bylonder'), { recursive: true });
writeFileSync(join(from, 'scene.js'), 'export {};\n');
writeFileSync(join(from, 'bylonder', 'blend-scene.js'), new Uint8Array([1, 2, 3]));
const first = packageArchive(from), again = packageArchive(from);
assert.equal(first.hash, again.hash, 'the same package gets the same name');
assert.match(first.hash, /^[0-9a-f]{12}$/);
await installPackage(first.zip, to, `demo-${first.hash}.zip`);
assert.equal(readFileSync(join(to, 'scene.js'), 'utf8'), 'export {};\n', 'it unzips as it was');
assert.deepEqual([...readFileSync(join(to, 'bylonder', 'blend-scene.js'))], [1, 2, 3]);
assert.equal(readFileSync(join(to, '.key'), 'utf8'), `demo-${first.hash}.zip`, 'marked with its asset');
assert.equal(packageArchive(to).hash, first.hash, 'the marker is not part of its content');
writeFileSync(join(from, 'scene.js'), 'export const changed = 1;\n');
assert.notEqual(packageArchive(from).hash, first.hash, 'a changed package gets a new name');
rmSync(root, { recursive: true, force: true });
console.log('demo packages: zipped, named by content, unzipped as they were, and git-ignored');
