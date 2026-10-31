// The reference Blender (tools/blender-reference/install.sh): the release of the version the module is built from, in
// .blender-reference/ of the checkout (worktrees are inside it) or BLENDER_REFERENCE; null when not installed.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const version = JSON.parse(readFileSync(join(root, 'tools/blender-port/manifest.json'), 'utf8')).blender.replace(/^v/, '');
const executable = (dir) => join(dir, `blender-${version}-linux-x64/blender`);

export function referenceBlender() {
  if (process.env.BLENDER_REFERENCE) return executable(process.env.BLENDER_REFERENCE);
  for (let dir = root; dir !== dirname(dir); dir = dirname(dir)) {
    const path = executable(join(dir, '.blender-reference'));
    if (existsSync(path)) return path;
  }
  return null;
}
