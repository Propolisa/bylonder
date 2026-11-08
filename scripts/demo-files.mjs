// Blender's demo files (src/workspace/blender-demo-files.json) copied into the site, as blender.org serves them without
// the CORS headers a page needs to download them: node scripts/demo-files.mjs [DIR] (default dist/blender-demo-files).
// A file already there at its listed size is kept; one that fails to download is left out and listed. The dev server
// fetches each on first request (demoFile).
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const { files } = JSON.parse(readFileSync(new URL('../src/workspace/blender-demo-files.json', import.meta.url), 'utf8'));

// The demo file's path in dir, downloaded unless already there at its listed size; null for an unlisted id.
export async function demoFile(id, dir) {
  const file = files.find((f) => f.id === id);
  if (!file) return null;
  const path = `${dir}/${id}.blend`;
  if (existsSync(path) && statSync(path).size === file.size) return path;
  const response = await fetch(file.url);
  if (!response.ok) throw Error(`${file.url} answered ${response.status}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path, Buffer.from(await response.arrayBuffer()));
  return path;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2] ?? 'dist/blender-demo-files';
  const missing = [];
  for (const { id, url } of files) await demoFile(id, dir).catch((error) => missing.push(`${id} (${url}): ${error.message}`));
  console.log(`${files.length - missing.length} of ${files.length} demo files in ${dir}`);
  for (const line of missing) console.log(`missing: ${line}`);
}
