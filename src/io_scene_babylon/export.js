// File > Export > Babylon (.babylon) and JavaScript (.zip), run in the scene window. JavaScript is a package: scene.js
// with its types, scene.bin, images/, the page runtime in bylonder/ and the blocks library files it imports (runtime/,
// MIT OR Apache-2.0); with Live Modifiers, modifiers.wasm in bylonder-modifiers/, and with Geometry Nodes, Blender's
// Geometry Nodes kernels in bylonder-geometry-nodes/, with curves their blocks in bylonder-curves/ and with volumes the
// volume passes in bylonder-volumes/ (GPL, runtime-files.js gplFiles).
import { zipSync, strToU8 } from 'fflate';
import { serializeScene } from './babylon-export.js';
import { exportModule } from './js-export.js';
import { gplFiles, packagedModules, packagedRuntime, packageOverrides, packageRuntime } from './runtime-files.js';
import { MODULES } from './module-files.js';
import { exportOptions } from './export-options.js';

const runtime = import.meta.glob('./runtime/**/*', { query: '?raw', import: 'default', eager: true });
const overrides = import.meta.glob('../overrides/**/*', { query: '?raw', import: 'default', eager: true });

// The files of gplFiles as the app serves them, by src/ path: text, or a module's bytes.
const bytes = (url) => async () => new Uint8Array(await (await fetch(await url())).arrayBuffer());
const text = (load) => async () => (await load()).default;
const SOURCES = {
  'io_scene_babylon/polyfill/modifiers-worker.bundle.js': text(() => import('./polyfill/modifiers-worker.bundle.js?raw')),
  'io_scene_babylon/polyfill/geometry-nodes-kernels.bundle.js': text(() => import('./polyfill/geometry-nodes-kernels.bundle.js?raw')),
  'draw/curves-blocks.js': text(() => import('../draw/curves-blocks.js?raw')),
  'io_scene_babylon/polyfill/volumes.bundle.js': text(() => import('./polyfill/volumes.bundle.js?raw')),
  'blenkernel/light/area-specular.js': text(() => import('../blenkernel/light/area-specular.js?raw')),
  'io_scene_babylon/blender-code.LICENSE.md': text(() => import('./blender-code.LICENSE.md?raw')),
  '../LICENSES/GPL-3.0-or-later.txt': text(() => import('../../LICENSES/GPL-3.0-or-later.txt?raw')),
  ...Object.fromEntries(Object.entries(MODULES).map(([path, url]) => [path, bytes(url)])),
};

// The package's files as the zip holds them.
async function scenePackage(world, options) {
  const files = await exportModule(world, options);
  for (const [path, name] of packageRuntime(files)) files[path] = packagedRuntime(runtime['./runtime/' + name]);
  for (const [path, from] of packageOverrides(files)) files[path] = overrides['../' + from];
  for (const [path, from] of gplFiles(files)) files[path] = await SOURCES[from]();
  return Object.fromEntries(Object.entries(packagedModules(files)).map(([path, data]) => [path, typeof data === 'string' ? strToU8(data) : data]));
}

const FORMATS = {
  babylon: { extension: 'babylon', type: 'application/json', build: async (world, name, { parity, runtime, runtimes }) => JSON.stringify(await serializeScene(world, { parity, runtime, runtimes })) },
  js: { extension: 'zip', type: 'application/zip', build: async (world, name, options) => zipSync(await scenePackage(world, options)) },
  'js-live': { extension: 'zip', type: 'application/zip', build: async (world, name, options) => zipSync(await scenePackage(world, { ...options, live: true })) },
};

// `options`: export-options.js ExportOptionsSchema's, which export-dialog.js asks for.
export async function exportScene(world, { format, ...options }) {
  const { extension, type, build } = FORMATS[format];
  const name = world.sceneSettings.state.name || 'scene';
  const { eeveeParity, ...rest } = exportOptions(options);
  const blob = new Blob([await build(world, name, { parity: eeveeParity, ...rest })], { type });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `${name}.${extension}` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}
