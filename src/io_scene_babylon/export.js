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
  babylon: { extension: 'babylon', type: 'application/json', build: async (world) => JSON.stringify(await serializeScene(world)) },
  js: { extension: 'js', type: 'text/javascript', build: exportModule },
  'js-live': {
    extension: 'zip', type: 'application/zip',
    build: async (world, name) => zipSync({ [name + '.js']: strToU8(await exportModule(world, { live: true })), 'bylonder-modifiers': await polyfill() }),
  },
};

export async function exportScene(world, format) {
  const { extension, type, build } = FORMATS[format];
  const name = world.sceneSettings.state.name || 'scene';
  const blob = new Blob([await build(world, name)], { type });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `${name}.${extension}` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}
