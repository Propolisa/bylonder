import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { imports, resolveImport } from '../scripts/import-graph.mjs';

// Every relative import in src/ resolves, so a deleted module that something still imports fails here, not in the
// production build.
const GENERATED = /(^|\/)bl_py(\/|$)/;
const files = (await readdir('src', { recursive: true })).map((f) => join('src', f)).filter((f) => /\.(js|mjs|vue)$/.test(f) && !GENERATED.test(f));
const missing = files.flatMap((file) => imports(file).filter((spec) => !resolveImport(file, spec)).map((spec) => `${file}: ${spec}`));
assert.deepEqual(missing, [], 'imports of modules that do not exist');
console.log(`Imports: every relative import of ${files.length} modules resolves`);
