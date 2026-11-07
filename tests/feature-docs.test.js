// Every feature page is valid and docs/features/index.json and README.md are what its front matter makes
// (scripts/feature-docs.mjs); the docs' front matter reader reads what the pages use.
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { frontMatter } from '../src/feature-docs.js';

const { data, body } = frontMatter('---\nid: x\ntitle: "A: b"\nui: [A, B]\nlimits:\n  - one: two\n  - three\n---\n# Body\n');
assert.deepEqual(data, { id: 'x', title: 'A: b', ui: ['A', 'B'], limits: ['one: two', 'three'] });
assert.equal(body, '# Body\n');
assert.deepEqual(frontMatter('# No front matter').data, {});

console.log(execFileSync(process.execPath, [fileURLToPath(new URL('../scripts/feature-docs.mjs', import.meta.url)), '--check'], { encoding: 'utf8' }).trim());
