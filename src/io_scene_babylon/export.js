// File > Export > Babylon (.babylon) and JavaScript (.zip), run in the scene window. JavaScript is a package: scene.js
// with its types, scene.bin, images/, the page runtime in bylonder/ and the blocks library files it imports (runtime/,
// MIT OR Apache-2.0); with Live Modifiers, the modifier kernels polyfill in bylonder-modifiers/ too.
import { zipSync, strToU8 } from 'fflate';
import { serializeScene } from './babylon-export.js';
import { exportModule } from './js-export.js';
import { packageRuntime } from './runtime-files.js';

const runtime = import.meta.glob('./runtime/**/*', { query: '?raw', import: 'default', eager: true });

// The polyfill's files as an export ships them.
async function polyfill() {
  const [{ default: main }, { default: worker }, { default: wasm }] = await Promise.all([
    import('./polyfill/modifiers.js?raw'), import('./polyfill/modifiers-worker.bundle.js?raw'), import('../modifiers/modifiers.wasm?url'),
  ]);
  return { 'modifiers.js': strToU8(main), 'modifiers-worker.js': strToU8(worker), 'modifiers.wasm': new Uint8Array(await (await fetch(wasm)).arrayBuffer()) };
}

// The package's files as the zip holds them.
async function scenePackage(world, options) {
  const files = await exportModule(world, options);
  for (const [path, name] of packageRuntime(files['scene.js'])) files[path] = runtime['./runtime/' + name];
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
// { hostCompression }, a package's scene.bin uncompressed for a host that compresses it.
export async function exportScene(world, { format, eeveeParity = false, hostCompression = false }) {
  const { extension, type, build } = FORMATS[format];
  const name = world.sceneSettings.state.name || 'scene';
  const blob = new Blob([await build(world, name, { parity: eeveeParity, hostCompression })], { type });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `${name}.${extension}` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}
