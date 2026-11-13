// Blender's module (src/bmesh/bmesh.wasm) and the files its CPython reads (python313.zip, scripts.zip, addons.zip) are built from
// tools/blender-port and published by CI as release assets named by that tree's git hash
// (.github/workflows/blender-wasm.yml), not kept in git.
//   node scripts/module.mjs        fetches them for the checked-out tree unless a local build is in place
//   node scripts/module.mjs key    prints the tree's key (module-<hash>)
//   --force                        replaces a local build too
// Each release also holds bmesh-names.wasm: the same module with its function names, whose code offsets match, to name
// the frames of a crash reported from the live site.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const REPO = 'Propolisa/bylonder';
const DIR = 'src/bmesh', FILES = ['bmesh.wasm', 'python313.zip', 'scripts.zip', 'addons.zip'];
const MODULE = `${DIR}/bmesh.wasm`, MARK = `${MODULE}.key`;
const key = () => `module-${execFileSync('git', ['rev-parse', 'HEAD:tools/blender-port'], { encoding: 'utf8' }).trim()}`;

/** The installed module's key when it is a fetched one that this tree no longer wants, else null (a local build has none). */
export function staleModule(mark = MARK) {
  const installed = existsSync(mark) && readFileSync(mark, 'utf8').trim();
  return installed && installed !== key() ? installed : null;
}

// GitHub's release downloads answer 5xx at times: retried, a missing release (404) is not.
async function fetchRetried(url, tries = 6) {
  for (let i = 1; ; i++) {
    const response = await fetch(url).catch((error) => ({ ok: false, status: error.message }));
    if (response.ok || response.status === 404 || i === tries) return response;
    await new Promise((done) => setTimeout(done, 15000 * i));
  }
}

async function fetchModule(force) {
  const wanted = key();
  const fetched = existsSync(MARK) && readFileSync(MARK, 'utf8');
  const present = FILES.every((file) => existsSync(`${DIR}/${file}`));
  if (fetched === wanted && present) return console.log(`${MODULE} is ${wanted}`);
  // A module without a key is a local build (tools/blender-port/blender_build.py), kept unless forced.
  if (existsSync(MODULE) && !fetched && !force) return console.log(`${MODULE} is a local build; --force replaces it with ${wanted}`);
  for (const file of FILES) {
    const url = `https://github.com/${REPO}/releases/download/${wanted}/${file}`;
    const response = await fetchRetried(url);
    if (!response.ok) throw Error(`${url}: ${response.status}. CI publishes it when this tree reaches main (the Pages deploy builds it if missing); or build it with tools/blender-port/blender_build.py`);
    writeFileSync(`${DIR}/${file}`, Buffer.from(await response.arrayBuffer()));
  }
  writeFileSync(MARK, wanted);
  console.log(`${MODULE}: ${wanted}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] === 'key') console.log(key());
  else await fetchModule(process.argv.includes('--force'));
}
