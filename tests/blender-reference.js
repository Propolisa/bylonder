// The reference Blender (tools/blender-reference/install.mjs): the release of the version the module is built from, in
// .tools/blender/ of the checkout (worktrees are inside it), or BLENDER_REFERENCE (that directory, or a Blender
// executable); null when not installed.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
export const version = JSON.parse(readFileSync(join(root, 'tools/blender-port/manifest.json'), 'utf8')).blender.replace(/^v/, '');
// Blender's release for this platform: its archive's name and its executable in it.
export const release = {
  linux: { name: `blender-${version}-linux-x64`, archive: 'tar.xz', executable: 'blender' },
  win32: { name: `blender-${version}-windows-x64`, archive: 'zip', executable: 'blender.exe' },
}[process.platform] ?? null;
const executable = (dir) => (release ? join(dir, release.name, release.executable) : null);

export function referenceBlender() {
  const given = process.env.BLENDER_REFERENCE;
  if (given) return statSync(given, { throwIfNoEntry: false })?.isFile() ? given : executable(given);
  for (let dir = root; dir !== dirname(dir); dir = dirname(dir)) {
    const path = executable(join(dir, '.tools', 'blender'));
    if (path && existsSync(path)) return path;
  }
  return null;
}
