// File > Export > Babylon (.babylon) and JavaScript (.zip), run in the scene window. JavaScript is a package: scene.js
// with its types, scene.bin, images/, the page runtime in bylonder/ and the blocks library files it imports (runtime/,
// MIT OR Apache-2.0); with Live Modifiers, the modifier kernels polyfill in bylonder-modifiers/ too; with Include Source
// .blend, scene.blend and the Blender fallback in bylonder-blender/ (GPL-3.0-or-later).
import { zipSync, strToU8 } from 'fflate';
import { serializeScene } from './babylon-export.js';
import { exportModule } from './js-export.js';
import { packageRuntime, usesBlender } from './runtime-files.js';
import { BMESH_WASM } from '../bmesh/bmesh-module.js';

const runtime = import.meta.glob('./runtime/**/*', { query: '?raw', import: 'default', eager: true });

// The polyfill's files as an export ships them.
async function polyfill() {
  const [{ default: main }, { default: worker }, { default: wasm }] = await Promise.all([
    import('./polyfill/modifiers.js?raw'), import('./polyfill/modifiers-worker.bundle.js?raw'), import('../modifiers/modifiers.wasm?url'),
  ]);
  return { 'modifiers.js': strToU8(main), 'modifiers-worker.js': strToU8(worker), 'modifiers.wasm': new Uint8Array(await (await fetch(wasm)).arrayBuffer()) };
}

// The Blender fallback (runtime-files.js FALLBACK_FILES) as the app serves it.
async function blenderFallback() {
  const bytes = async (url) => new Uint8Array(await (await fetch(url)).arrayBuffer());
  const [{ default: blender }, { default: license }, { default: copying }, { default: tessellate }] = await Promise.all([import('./blender-fallback.bundle.js?raw'),
    import('./blender-fallback.LICENSE.md?raw'), import('../../LICENSES/GPL-3.0-or-later.txt?raw'), import('../blenkernel/mesh/mesh-tessellate.wasm?url')]);
  return { 'bylonder-blender/blender.js': blender, 'bylonder-blender/LICENSE.md': license, 'bylonder-blender/COPYING': copying,
    'bylonder-blender/bmesh.wasm': await bytes(BMESH_WASM), 'bylonder-blender/mesh-tessellate.wasm': await bytes(tessellate) };
}

// The package's files as the zip holds them.
async function scenePackage(world, options) {
  const files = await exportModule(world, options);
  for (const [path, name] of packageRuntime(files['scene.js'])) files[path] = runtime['./runtime/' + name];
  if (usesBlender(files['scene.js'])) Object.assign(files, await blenderFallback());
  return Object.fromEntries(Object.entries(files).map(([path, data]) => [path, typeof data === 'string' ? strToU8(data) : data]));
}

const FORMATS = {
  babylon: { extension: 'babylon', type: 'application/json', build: async (world, name, { parity }) => JSON.stringify(await serializeScene(world, { parity })) },
  js: { extension: 'zip', type: 'application/zip', build: async (world, name, options) => zipSync(await scenePackage(world, options)) },
  'js-live': {
    extension: 'zip', type: 'application/zip',
    build: async (world, name, options) => zipSync({ ...(await scenePackage(world, { ...options, live: true })), 'bylonder-modifiers': await polyfill() }),
  },
};

// `options` (topbar.js asks for them): { eeveeParity }, materials with Bylonder's EEVEE extensions, as Babylon's blocks;
// { hostCompression }, a package's scene.bin uncompressed for a host that compresses it; { sourceBlend }, a package's
// scene.blend and the Blender fallback that tunes what only Blender evaluates.
export async function exportScene(world, { format, eeveeParity = false, hostCompression = false, sourceBlend = false }) {
  const { extension, type, build } = FORMATS[format];
  const name = world.sceneSettings.state.name || 'scene';
  const blob = new Blob([await build(world, name, { parity: eeveeParity, hostCompression, sourceBlend })], { type });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `${name}.${extension}` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}
