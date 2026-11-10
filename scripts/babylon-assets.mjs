// Files Babylon.js loads from its CDNs, served by the app from public/ so it works offline and exported pages carry them
// (io_scene_babylon/runtime-files.js appFiles): its GLSL to WGSL compilers (glslang, then Tint as twgsl) for the WebGPU
// backend (src/render/gpu-engine.js), from Babylon's CDN at the installed @babylonjs/core version, and its area lights'
// LTC table (Lights/LTC/ltcTextureTool.js), from its assets site; neither is in an npm package, so each is pinned by
// sha256; the build runs this. Files already in place with the pinned hashes are kept (CI caches the folders).
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';

const { version } = createRequire(import.meta.url)('@babylonjs/core/package.json');
// Each file's place in public/, its URL and its sha256.
const FILES = {
  'webgpu/glslang.js': [`https://cdn.babylonjs.com/v${version}/glslang/glslang.js`, 'c3a3c2a47284b16b60293fa08a5842fbe8689ac617edc857ab6cb8134a590db4'],
  'webgpu/glslang.wasm': [`https://cdn.babylonjs.com/v${version}/glslang/glslang.wasm`, 'd79453e0803ebcdf3753c6b1d8d51543b52fed96f7f0d4aec94acd847e225169'],
  'webgpu/twgsl.js': [`https://cdn.babylonjs.com/v${version}/twgsl/twgsl.js`, 'b4f1f66263b801210f955f74aa71f1939be647ce0fd80ea5befd12a78499d5ff'],
  'webgpu/twgsl.wasm': [`https://cdn.babylonjs.com/v${version}/twgsl/twgsl.wasm`, 'a434c2decdbb38caadf5f486d806384a1543554828c983c77922b2d92579914c'],
  'babylon-assets/areaLights/areaLightsLTC.bin': ['https://assets.babylonjs.com/core/areaLights/areaLightsLTC.bin', '44d531d71dc6aa7b0192a1d9f8270c3b0f1e74ea0c95df1bdd587ec37db70891'],
};
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

for (const [path, [url, hash]] of Object.entries(FILES)) {
  const target = `public/${path}`;
  if (existsSync(target) && sha256(readFileSync(target)) === hash) continue;
  const bytes = await download(url);
  if (sha256(bytes) !== hash) {
    console.error(`${url} does not match its pinned sha256 (${hash}, got ${sha256(bytes)}). After a Babylon update, check the file and pin its new hash in scripts/babylon-assets.mjs.`);
    process.exit(1);
  }
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, bytes);
  console.log(`${target}: Babylon ${version}`);
}
