import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseAst } from 'vite';

// Every relative import in src/ resolves, so a deleted module that something still imports fails here, not in the
// production build.
const GENERATED = /(^|\/)bl_py(\/|$)/;
const files = (await readdir('src', { recursive: true })).map((f) => join('src', f)).filter((f) => /\.(js|mjs|vue)$/.test(f) && !GENERATED.test(f));
const script = (file, text) => (file.endsWith('.vue') ? [...text.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n') : text);
const resolves = (from, spec) => {
  const path = resolve(dirname(from), spec.split('?')[0]);
  return [path, `${path}.js`, `${path}.ts`, join(path, 'index.js')].some(existsSync);
};

const IMPORTS = new Set(['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration', 'ImportExpression']);
const missing = [];
for (const file of files) {
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(visit);
    const { source } = node;
    if (IMPORTS.has(node.type) && source?.type === 'Literal' && /^\.\.?\//.test(source.value) && !resolves(file, source.value)) missing.push(`${file}: ${source.value}`);
    for (const key in node) if (key !== 'source') visit(node[key]);
  };
  visit(parseAst(script(file, await readFile(file, 'utf8'))));
}
assert.deepEqual(missing, [], 'imports of modules that do not exist');
console.log(`Imports: every relative import of ${files.length} modules resolves`);
