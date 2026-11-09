// File > Export > Babylon (.babylon) and JavaScript (.zip), run in the scene window. JavaScript is a package: scene.js
// with its types, scene.bin, images/, the page runtime in bylonder/ and the blocks library files it imports (runtime/,
// MIT OR Apache-2.0); with Live Modifiers, modifiers.wasm in bylonder-modifiers/, and with Include Source .blend,
// scene.blend and the Blender fallback in bylonder-blender/ (GPL-3.0-or-later, runtime-files.js gplFiles).
import { zipSync, strToU8 } from 'fflate';
import { serializeScene } from './babylon-export.js';
import { exportModule } from './js-export.js';
import { gplFiles, packagedRuntime, packageOverrides, packageRuntime } from './runtime-files.js';
import { BMESH_WASM } from '../bmesh/bmesh-module.js';

const runtime = import.meta.glob('./runtime/**/*', { query: '?raw', import: 'default', eager: true });
const overrides = import.meta.glob('../overrides/**/*', { query: '?raw', import: 'default', eager: true });

// The files of gplFiles as the app serves them, by src/ path: text, or a module's bytes.
const bytes = (url) => async () => new Uint8Array(await (await fetch(await url())).arrayBuffer());
const text = (load) => async () => (await load()).default;
const SOURCES = {
  'io_scene_babylon/polyfill/modifiers-worker.bundle.js': text(() => import('./polyfill/modifiers-worker.bundle.js?raw')),
  'io_scene_babylon/blender-fallback.bundle.js': text(() => import('./blender-fallback.bundle.js?raw')),
  'io_scene_babylon/blender-code.LICENSE.md': text(() => import('./blender-code.LICENSE.md?raw')),
  '../LICENSES/GPL-3.0-or-later.txt': text(() => import('../../LICENSES/GPL-3.0-or-later.txt?raw')),
  'modifiers/modifiers.wasm': bytes(async () => (await import('../modifiers/modifiers.wasm?url')).default),
  'bmesh/bmesh.wasm': bytes(async () => BMESH_WASM),
  'blenkernel/mesh/mesh-tessellate.wasm': bytes(async () => (await import('../blenkernel/mesh/mesh-tessellate.wasm?url')).default),
};

// The package's files as the zip holds them.
async function scenePackage(world, options) {
  const files = await exportModule(world, options);
  for (const [path, name] of packageRuntime(files)) files[path] = packagedRuntime(runtime['./runtime/' + name]);
  for (const [path, from] of packageOverrides()) files[path] = overrides['../' + from];
  for (const [path, from] of gplFiles(files)) files[path] = await SOURCES[from]();
  return Object.fromEntries(Object.entries(files).map(([path, data]) => [path, typeof data === 'string' ? strToU8(data) : data]));
}

const FORMATS = {
  babylon: { extension: 'babylon', type: 'application/json', build: async (world, name, { parity }) => JSON.stringify(await serializeScene(world, { parity })) },
  js: { extension: 'zip', type: 'application/zip', build: async (world, name, options) => zipSync(await scenePackage(world, options)) },
  'js-live': { extension: 'zip', type: 'application/zip', build: async (world, name, options) => zipSync(await scenePackage(world, { ...options, live: true })) },
};

// `options` (topbar.js asks for them): { eeveeParity }, materials with Bylonder's EEVEE extensions, as Babylon's blocks;
// { hostCompression }, a package's scene.bin uncompressed for a host that compresses it; { sourceBlend }, a package's
// scene.blend and the Blender fallback that tunes what only Blender evaluates; { bakeAnimation }, a package's animation
// sampled per frame where Babylon cannot play its F-Curves, instead of run as F-Curves in the page.
export async function exportScene(world, { format, eeveeParity = false, hostCompression = false, sourceBlend = false, bakeAnimation = false }) {
  const { extension, type, build } = FORMATS[format];
  const name = world.sceneSettings.state.name || 'scene';
  const blob = new Blob([await build(world, name, { parity: eeveeParity, hostCompression, sourceBlend, bakeAnimation })], { type });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `${name}.${extension}` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}
