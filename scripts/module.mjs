// Blender's module (src/bmesh/bmesh.wasm) is built from tools/blender-port and published by CI as a release asset named
// by that tree's git hash (.github/workflows/blender-wasm.yml), not kept in git.
//   node scripts/module.mjs        fetches the module for the checked-out tree unless a local build is in place
//   node scripts/module.mjs key    prints the tree's key (module-<hash>)
//   --force                        replaces a local build too
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const REPO = 'Propolisa/bylonder';
const MODULE = 'src/bmesh/bmesh.wasm', MARK = `${MODULE}.key`;
const key = () => `module-${execFileSync('git', ['rev-parse', 'HEAD:tools/blender-port'], { encoding: 'utf8' }).trim()}`;

async function fetchModule(force) {
  const wanted = key();
  const fetched = existsSync(MARK) && readFileSync(MARK, 'utf8');
  if (fetched === wanted && existsSync(MODULE)) return console.log(`${MODULE} is ${wanted}`);
  // A module without a key is a local build (tools/blender-port/blender_build.py), kept unless forced.
  if (existsSync(MODULE) && !fetched && !force) return console.log(`${MODULE} is a local build; --force replaces it with ${wanted}`);
  const url = `https://github.com/${REPO}/releases/download/${wanted}/bmesh.wasm`;
  const response = await fetch(url);
  if (!response.ok) throw Error(`${url}: ${response.status}. CI publishes it when this tree reaches main (the Pages deploy builds it if missing); or build it with tools/blender-port/blender_build.py`);
  writeFileSync(MODULE, Buffer.from(await response.arrayBuffer()));
  writeFileSync(MARK, wanted);
  console.log(`${MODULE}: ${wanted}`);
}

if (process.argv[2] === 'key') console.log(key());
else await fetchModule(process.argv.includes('--force'));
