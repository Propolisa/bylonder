// File > Export > Babylon (.babylon) and JavaScript (.js), run in the scene window.
import { serializeScene } from './babylon-export.js';
import { exportModule } from './js-export.js';

const FORMATS = {
  babylon: { extension: 'babylon', type: 'application/json', build: async (world) => JSON.stringify(await serializeScene(world)) },
  js: { extension: 'js', type: 'text/javascript', build: exportModule },
};

export async function exportScene(world, format) {
  const { extension, type, build } = FORMATS[format];
  const blob = new Blob([await build(world)], { type });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `${world.sceneSettings.state.name || 'scene'}.${extension}` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}
