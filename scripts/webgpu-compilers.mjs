// Babylon's GLSL to WGSL compilers (glslang, then Tint as twgsl) for the WebGPU backend (src/render/gpu-engine.js),
// served by the app from public/webgpu/ so WebGPU works offline as WebGL 2 does. Neither is an npm package Babylon
// uses, so they come from Babylon's CDN at the installed @babylonjs/core version, pinned by sha256; the build runs this.
// Files already in place with the pinned hashes are kept (CI caches the folder).
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const DIR = 'public/webgpu';
const FILES = {
  'glslang/glslang.js': 'c3a3c2a47284b16b60293fa08a5842fbe8689ac617edc857ab6cb8134a590db4',
  'glslang/glslang.wasm': 'd79453e0803ebcdf3753c6b1d8d51543b52fed96f7f0d4aec94acd847e225169',
  'twgsl/twgsl.js': 'b4f1f66263b801210f955f74aa71f1939be647ce0fd80ea5befd12a78499d5ff',
  'twgsl/twgsl.wasm': 'a434c2decdbb38caadf5f486d806384a1543554828c983c77922b2d92579914c',
};
const { version } = createRequire(import.meta.url)('@babylonjs/core/package.json');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const ATTEMPTS = 4;

async function download(url) {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw Error(`HTTP ${response.status}`);
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      if (attempt === ATTEMPTS) throw Error(`${url}: ${error.message} after ${ATTEMPTS} attempts`);
      await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
    }
  }
}

mkdirSync(DIR, { recursive: true });
for (const [path, hash] of Object.entries(FILES)) {
  const target = `${DIR}/${path.split('/').pop()}`;
  if (existsSync(target) && sha256(readFileSync(target)) === hash) continue;
  const url = `https://cdn.babylonjs.com/v${version}/${path}`, bytes = await download(url);
  if (sha256(bytes) !== hash) {
    console.error(`${url} does not match its pinned sha256 (${hash}, got ${sha256(bytes)}). After a Babylon update, check the file and pin its new hash in scripts/webgpu-compilers.mjs.`);
    process.exit(1);
  }
  writeFileSync(target, bytes);
  console.log(`${target}: Babylon ${version}`);
}
