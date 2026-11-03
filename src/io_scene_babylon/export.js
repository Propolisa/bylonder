// File > Export > Babylon (.babylon) and JavaScript (.js), run in the scene window. JavaScript with Live Modifiers is
// a .zip: the module, and the modifier kernels polyfill in bylonder-modifiers/ next to it.
import { zipSync, strToU8 } from 'fflate';
import { serializeScene } from './babylon-export.js';
import { exportModule } from './js-export.js';

// The polyfill's files as an export ships them.
async function polyfill() {
  const [{ default: main }, { default: worker }, { default: wasm }] = await Promise.all([
    import('./polyfill/modifiers.js?raw'), import('./polyfill/modifiers-worker.bundle.js?raw'), import('../modifiers/modifiers.wasm?url'),
  ]);
  return { 'modifiers.js': strToU8(main), 'modifiers-worker.js': strToU8(worker), 'modifiers.wasm': new Uint8Array(await (await fetch(wasm)).arrayBuffer()) };
}

const FORMATS = {
  babylon: { extension: 'babylon', type: 'application/json', build: async (world, name, { parity }) => JSON.stringify(await serializeScene(world, { parity })) },
  js: { extension: 'js', type: 'text/javascript', build: (world, name, { parity }) => exportModule(world, { parity }) },
  'js-live': {
    extension: 'zip', type: 'application/zip',
    build: async (world, name, { parity }) => zipSync({ [name + '.js']: strToU8(await exportModule(world, { live: true, parity })), 'bylonder-modifiers': await polyfill() }),
  },
};

// `options`: { eeveeParity } (topbar.js asks for it): materials with Bylonder's EEVEE extensions, as Babylon's blocks.
export async function exportScene(world, { format, eeveeParity = false }) {
  const { extension, type, build } = FORMATS[format];
  const name = world.sceneSettings.state.name || 'scene';
  const blob = new Blob([await build(world, name, { parity: eeveeParity })], { type });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `${name}.${extension}` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}
