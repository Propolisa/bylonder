// The relative imports of src/ modules as Vite resolves them: static and dynamic imports, re-exports and workers
// (new URL('./x.js', import.meta.url)).
import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { parseAst } from 'vite';

const IMPORTS = new Set(['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration', 'ImportExpression']);
const script = (file, text) => (file.endsWith('.vue') ? [...text.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n') : text);
const isFile = (path) => existsSync(path) && statSync(path).isFile();

// The file (or, for a URL ending in '/', the directory) a relative specifier names, or null.
export function resolveImport(from, spec) {
  const path = resolve(dirname(from), spec.split('?')[0]);
  if (spec.endsWith('/')) return existsSync(path) ? path : null;
  return [path, `${path}.js`, `${path}.ts`, join(path, 'index.js')].find(isFile) ?? null;
}

// A module's relative import specifiers.
export function imports(file) {
  if (!/\.(js|mjs|vue)$/.test(file)) return [];
  const specs = [];
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(visit);
    if (IMPORTS.has(node.type) && node.source?.type === 'Literal') specs.push(node.source.value);
    if (node.type === 'NewExpression' && node.callee?.name === 'URL' && node.arguments[0]?.type === 'Literal') specs.push(node.arguments[0].value);
    for (const key in node) if (key !== 'source') visit(node[key]);
  };
  visit(parseAst(script(file, readFileSync(file, 'utf8'))));
  return specs.filter((spec) => typeof spec === 'string' && /^\.\.?\//.test(spec));
}

// Every src/ module reachable from the entries, as paths relative to the repository.
export function reachable(entries) {
  const seen = new Set(), queue = entries.map((entry) => resolve(entry));
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    for (const spec of imports(file)) {
      const target = resolveImport(file, spec);
      if (target) queue.push(target);
    }
  }
  return new Set([...seen].map((file) => relative(process.cwd(), file)));
}

// The scripts the production build's HTML entries load (vite.config.js rollupOptions.input).
export const APP_ENTRIES = ['index.html', 'viewport.html', 'render.html', 'docs.html']
  .flatMap((html) => [...readFileSync(html, 'utf8').matchAll(/<script[^>]*src="\/([^"]+\.js)"/g)].map((m) => m[1]));
