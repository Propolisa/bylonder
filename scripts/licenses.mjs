// Checks REUSE.toml (LICENSING.md) against the tracked files: every file has a license, every path entry matches a
// file, every license named has its text in LICENSES/, and Blender-derived code (`blender-port:` markers, generated
// ports) is under the GPL. Exits 1 with the problems listed.
// usage: node scripts/licenses.mjs [path]  (with a path: prints that file's license)
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const root = new URL('..', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

// The subset of TOML REUSE.toml uses: [[annotations]] tables of `key = "string"` or `key = ["strings"]`.
export function annotations(toml) {
  const tables = [];
  for (const block of toml.split(/^\[\[annotations\]\]\s*$/m).slice(1)) {
    const table = {};
    for (const [, key, value] of block.matchAll(/^([\w-]+)\s*=\s*("[^"]*"|\[[^\]]*\])/gm)) {
      table[key] = value.startsWith('[') ? [...value.replace(/#.*$/gm, '').matchAll(/"([^"]*)"/g)].map((m) => m[1]) : value.slice(1, -1);
    }
    table.path = [table.path].flat();
    tables.push(table);
  }
  return tables;
}

// REUSE's globs: `*` within a path segment, `**` across segments.
const pattern = (glob) => new RegExp(`^${glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*|\*/g, (s) => (s === '**' ? '.*' : '[^/]*'))}$`);

export function licenseOf(file, tables) {
  return tables.findLast((t) => t.path.some((glob) => pattern(glob).test(file)))?.['SPDX-License-Identifier'];
}

const tables = annotations(read('REUSE.toml'));
const files = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);

if (process.argv[2]) {
  console.log(licenseOf(process.argv[2], tables) ?? 'no license');
  process.exit(0);
}

const problems = [];
for (const file of files) if (!licenseOf(file, tables)) problems.push(`${file}: no license in REUSE.toml`);
for (const glob of tables.flatMap((t) => t.path)) {
  if (!files.some((f) => pattern(glob).test(f))) problems.push(`REUSE.toml: ${glob} matches no file`);
}
for (const id of new Set(tables.flatMap((t) => t['SPDX-License-Identifier'].match(/[\w.+-]+/g)).filter((w) => !['AND', 'OR', 'WITH'].includes(w)))) {
  if (!existsSync(new URL(`LICENSES/${id}.txt`, root))) problems.push(`LICENSES/${id}.txt missing`);
}
const marked = execFileSync('git', ['grep', '-l', '-I', 'blender-port:', '--', 'src', 'tools'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);
for (const file of [...marked, ...files.filter((f) => f.endsWith('.gen.js'))]) {
  if (!/GPL/.test(licenseOf(file, tables))) problems.push(`${file}: derived from Blender, but not under the GPL in REUSE.toml`);
}

if (problems.length) {
  console.log(problems.join('\n'));
  process.exit(1);
}
console.log(`${files.length} files licensed, ${marked.length} with blender-port markers under the GPL`);
