// A demo's exported package as a zip named by its content: the first 12 hex of the SHA-256 over its files' sorted
// paths and bytes, so the same package always gets the same name (the fetched .key marker left out).
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { zipSync } from 'fflate';

/** @param {string} dir the package folder @returns {{ zip: Uint8Array, hash: string }} */
export function packageArchive(dir) {
  const paths = readdirSync(dir, { recursive: true }).map((p) => String(p).replaceAll('\\', '/'))
    .filter((p) => p !== '.key' && statSync(join(dir, p)).isFile()).sort();
  const hash = createHash('sha256'), files = {};
  for (const path of paths) {
    const bytes = readFileSync(join(dir, path));
    hash.update(path).update('\0').update(bytes);
    files[path] = [bytes, { mtime: new Date(1980, 0, 1) }];
  }
  if (!paths.length) throw Error(`${dir} has no package: export it first (tools/docs/export-demo.mjs)`);
  return { zip: zipSync(files, { level: 6 }), hash: hash.digest('hex').slice(0, 12) };
}
