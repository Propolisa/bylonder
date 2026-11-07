// Builds Blender's WASM module (src/bmesh/bmesh.wasm and the files its CPython reads) from this checkout, as CI does:
// Blender's configure (configure_host.sh), then blender_build.py. On Linux it runs here, on a host set up by
// scripts/setup-build-host.sh. On Windows it runs in a WSL distro of its own, `bylonder-build`, whose disk is .tools/wsl/
// (delete it with `wsl --unregister bylonder-build`); Blender's sources and objects stay on that disk, the module is
// copied back. A local build installs itself (scripts/module.mjs keeps it).
// usage: node scripts/build-module.mjs   (JOBS=n: sources compiled at a time)
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('..', import.meta.url));
const DISTRO = 'bylonder-build';
const ROOTFS = 'https://cloud-images.ubuntu.com/wsl/releases/24.04/current/ubuntu-noble-wsl-amd64-wsl.rootfs.tar.gz';
const OUTPUTS = ['bmesh.wasm', 'python313.zip', 'scripts.zip', 'addons.zip'];
const BUILD = (dir) => `set -euo pipefail; bash tools/blender-port/configure_host.sh ${dir}; JOBS=\${JOBS:-$(nproc)} python3.13 tools/blender-port/blender_build.py ${dir}/build-host`;

const run = (command, args, options = {}) => execFileSync(command, args, { stdio: 'inherit', ...options });

if (process.platform === 'linux') {
  run('bash', ['-c', BUILD('work')], { cwd: repo });
} else if (process.platform === 'win32') {
  const wsl = (script) => run('wsl', ['-d', DISTRO, '-u', 'root', '--', 'bash', '-lc', script]);
  const distros = execFileSync('wsl', ['-l', '-q'], { encoding: 'utf16le' }).split(/\r?\n/).map((d) => d.trim());
  if (!distros.includes(DISTRO)) {
    const dir = join(repo, '.tools', 'wsl'), rootfs = join(dir, 'ubuntu.rootfs.tar.gz');
    mkdirSync(dir, { recursive: true });
    if (!existsSync(rootfs)) writeFileSync(rootfs, Buffer.from(await (await fetch(ROOTFS)).arrayBuffer()));
    run('wsl', ['--import', DISTRO, dir, rootfs, '--version', '2']);
    rmSync(rootfs);
  }
  const mounted = execFileSync('wsl', ['-d', DISTRO, '-u', 'root', '--', 'wslpath', '-a', repo.replaceAll('\\', '/')], { encoding: 'utf8' }).trim();
  wsl(`bash '${mounted}/scripts/setup-build-host.sh'`);
  // The checkout's files on the distro's own disk (compiling across the Windows mount is slow), then the build there.
  wsl(`mkdir -p /root/bylonder && rsync -a --delete --exclude node_modules --exclude .tools --exclude dist --exclude .git '${mounted}/' /root/bylonder/ && cd /root/bylonder && ${BUILD('/root/work')}`);
  wsl(`cd /root/bylonder/src/bmesh && cp ${OUTPUTS.join(' ')} '${mounted}/src/bmesh/'`);
  rmSync(join(repo, 'src/bmesh/bmesh.wasm.key'), { force: true });
  console.log('src/bmesh/bmesh.wasm: a local build');
} else {
  throw Error(`Build the module on Linux or Windows (WSL); ${process.platform} is not set up`);
}
