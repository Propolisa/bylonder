// Installs the reference Blender: the release of the version the module is built from (tools/blender-port/manifest.json
// "blender"), into .tools/blender/ (git-ignored), once, on Linux and Windows. Prints the executable's path. On other
// platforms set BLENDER_REFERENCE to an installed Blender of that version.
// usage: node tools/blender-reference/install.mjs   (BLENDER_REFERENCE: another directory to install into)
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { referenceBlender, release, version } from '../../tests/blender-reference.js';

if (!release) throw Error(`No Blender release to install on ${process.platform}: set BLENDER_REFERENCE to a Blender ${version} executable`);
const dir = process.env.BLENDER_REFERENCE ?? fileURLToPath(new URL('../../.tools/blender', import.meta.url));
if (!existsSync(join(dir, release.name, release.executable))) {
  mkdirSync(dir, { recursive: true });
  const archive = join(dir, `${release.name}.${release.archive}`);
  const url = `https://download.blender.org/release/Blender${version.replace(/\.\d+$/, '')}/${release.name}.${release.archive}`;
  const response = await fetch(url);
  if (!response.ok) throw Error(`${url} answered ${response.status}`);
  writeFileSync(archive, Buffer.from(await response.arrayBuffer()));
  execFileSync('tar', ['-xf', archive, '-C', dir]);
  rmSync(archive);
}
const blender = referenceBlender();
execFileSync(blender, ['--version']);
console.log(blender);
