// Blender's demo files (src/workspace/blender-demo-files.json) copied into the site, as blender.org serves them without
// the CORS headers a page needs to download them: node scripts/demo-files.mjs [DIR] (default dist/blender-demo-files).
// A file already there at its listed size is kept; one that fails to download is left out and listed.
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';

const dir = process.argv[2] ?? 'dist/blender-demo-files';
const { files } = JSON.parse(readFileSync(new URL('../src/workspace/blender-demo-files.json', import.meta.url), 'utf8'));
mkdirSync(dir, { recursive: true });
const missing = [];
for (const { id, url, size } of files) {
  const path = `${dir}/${id}.blend`;
  if (existsSync(path) && statSync(path).size === size) continue;
  try {
    const response = await fetch(url);
    if (!response.ok) throw Error(`${response.status}`);
    writeFileSync(path, Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    missing.push(`${id} (${url}): ${error.message}`);
  }
}
console.log(`${files.length - missing.length} of ${files.length} demo files in ${dir}`);
for (const line of missing) console.log(`missing: ${line}`);
