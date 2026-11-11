// Files Babylon.js loads from its CDNs, served by the app from public/ so it works offline and exported pages carry them
// (io_scene_babylon/runtime-files.js appFiles): its GLSL to WGSL compilers (glslang, then Tint as twgsl) for the WebGPU
// backend (src/render/gpu-engine.js), from Babylon's CDN at the installed @babylonjs/core version, and its area lights'
// LTC table (Lights/LTC/ltcTextureTool.js), from its assets site; neither is in an npm package, so each is pinned by
// sha256; the build runs this. Files already in place with the pinned hashes are kept (CI caches the folders).
// Also Babylon's editors for an exported page's control panel (io_scene_babylon/runtime/dev-tools.js), which a package
// made with Editors In the Package ships: their bundles from the npm packages, and Babylon's GUI, which npm has only as
// modules, bundled here as Babylon's CDN has it (reading Babylon from the global BABYLON).
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { build } from 'esbuild';
import { DEV_TOOLS } from '../src/io_scene_babylon/runtime/dev-tools.js';
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

const EDITORS = { inspector: '@babylonjs/inspector/dist/babylon.inspector.bundle.js', nodeEditor: '@babylonjs/node-editor/dist/babylon.nodeEditor.js',
  nodeRenderGraphEditor: '@babylonjs/node-render-graph-editor/dist/babylon.nodeRenderGraphEditor.js' };
const require = createRequire(import.meta.url), editor = (tool) => `public/bylonder-dev-tools/${DEV_TOOLS[tool]}`;
for (const [tool, from] of Object.entries(EDITORS)) {
  mkdirSync(dirname(editor(tool)), { recursive: true });
  for (const notice of ['', '.LICENSE.txt']) copyFileSync(require.resolve(from + notice), editor(tool) + notice);
}
copyFileSync(require.resolve('@babylonjs/core/license.md'), 'public/bylonder-dev-tools/LICENSE.md');
// Babylon's core as the page has it, from the global the editors read (tslib's helpers are bundled).
const babylonGlobal = { name: 'babylon-global', setup(esbuild) {
  esbuild.onResolve({ filter: /^@babylonjs\/core\// }, ({ path }) => (path.includes('tslib') ? undefined : { path, namespace: 'babylon-global' }));
  esbuild.onLoad({ filter: /.*/, namespace: 'babylon-global' }, () => ({ contents: 'module.exports = globalThis.BABYLON;' }));
} };
const gui = editor('gui'), guiVersion = `/* Babylon.js GUI ${version} */`;
if (!existsSync(gui) || !readFileSync(gui, 'utf8').startsWith(guiVersion)) {
  mkdirSync(dirname(gui), { recursive: true });
  await build({ stdin: { contents: "import * as GUI from '@babylonjs/gui/index.js'; globalThis.BABYLON.GUI = GUI;", resolveDir: process.cwd() }, bundle: true,
    minify: true, format: 'iife', banner: { js: guiVersion }, outfile: gui, plugins: [babylonGlobal], logLevel: 'error' });
  console.log(`${gui}: Babylon ${version}`);
}
