// The Game area (docs/data-flow.md, From .blend to the game views), Bylonder's own editor: the scene as File > Export >
// JavaScript ships it, run by the exported page's own runtime (load, BlendScene) in the app's module graph
// (game-run.js), on an engine of its own on the area's canvas, made as the page makes it (scene.js createEngine). Its tables are the live package's (package-preview.js): each edit, undo or redo reaches
// the game as a patch, one way, from Main; nothing the game runs writes into Main or the live package, which it holds
// frozen. Pause holds the game's frame; Reset drops the run and loads the live version again.
import * as core from '@babylonjs/core';
import { createApp, h, reactive } from 'vue';
import GameView from './GameView.vue';
import { createGameRun } from './game-run.js';
import { createPackagePreview } from '../space_package/package-preview.js';
import { packagedFiles } from '../../io_scene_babylon/export.js';
import { exportOptions } from '../../io_scene_babylon/export-options.js';
import { sharedStatus } from '../../io_scene_babylon/runtime/shared-resources.js';
import { publishFiles, removeRun } from '../../workspace/module-host.js';
import { registerOperator } from '../../windowmanager/wm-operators.js';

// The app's modules a package's scene.js imports (runtime-files.js appSource), by src/ path.
const sources = import.meta.glob(['../../io_scene_babylon/runtime/**/*.js', '../../overrides/**/*.js', '../../blenkernel/light/area-specular.js', '../../compositor/fog-glow.js',
  '../../io_scene_babylon/panel-icons.js', '../../io_scene_babylon/polyfill/volumes.js', '../../draw/curves-blocks.js', '../../draw/pointcloud.js']);
const appModule = (source) => (source === '@babylonjs/core' ? core : sources[`../../${source}`]());

export function mountGameView(section, { world, header }) {
  const state = reactive({ status: '', shared: '', busy: false, running: false, paused: false });
  // WebGL 2, whatever the app draws with, until exported pages draw on WebGPU again (the area light fixes in progress).
  const options = exportOptions({ controlPanel: false, target: 'WEBGL2' });
  const canvas = Object.assign(document.createElement('canvas'), { className: 'block h-full w-full outline-none', tabIndex: 0 });
  const game = createGameRun({ appModule, exportAgain: () => preview.reload(), engine: (createEngine) => createEngine(canvas) });
  // The area's size is the game's, as a page's canvas is its engine's.
  const resized = new ResizeObserver(() => game.engine?.resize());
  resized.observe(canvas);
  let base = null, patching = Promise.resolve(), looping = null;
  const report = (status) => { state.status = status; };
  const shown = () => {
    state.shared = game.blend ? sharedStatus(game.blend.scene) : '';
    if (looping === game.engine) return;
    looping = game.engine;
    looping.runRenderLoop(() => { if (!state.paused) game.blend?.scene.render(); });
  };
  const preview = createPackagePreview({
    world, options, report,
    publish: async (made, tables) => {
      const next = await publishFiles(await packagedFiles(made.files, options));
      if (base) await removeRun(base);
      await game.play(made, tables, new URL((base = next), location.href).href);
      shown();
      return base;
    },
    post: (patch) => {
      patching = patching.then(async () => {
        if (!state.running) return;
        if (!(await game.patch(patch, preview.state))) report('Loaded again: a patch did not apply');
        shown();
      }).catch((error) => report(`Not loaded: ${error.message}`));
    },
  });
  const run = (label, fn) => async () => {
    state.busy = true;
    try { await fn(); } catch (error) { report(`${label} failed: ${error.message}`); } finally { state.busy = false; }
  };
  const pause = () => {
    state.paused = !state.paused;
    report(state.paused ? 'Paused' : 'Playing');
  };
  const play = run('Play', async () => {
    if (state.running) { pause(); return; }
    await preview.reload();
    Object.assign(state, { running: true, paused: false });
    report('Playing');
  });
  const reset = run('Reset', async () => {
    await preview.settled();
    await patching;
    await game.reset(preview.state);
    shown();
    state.paused = false;
    report('Reset');
  });
  registerOperator('bylonder.game_play', { poll: () => !state.busy, run: play });
  registerOperator('bylonder.game_pause', { poll: () => state.running, run: pause });
  registerOperator('bylonder.game_reset', { poll: () => state.running && !state.busy, run: reset });
  createApp({ render: () => h(GameView, { ...state, header, canvas, onPlay: play, onPause: pause, onReset: reset }) }).mount(section);
  return {
    changed: () => state.running && preview.changed(),
    settled: async () => { await preview.settled(); await patching; },
    get blend() { return game.blend; },
    dispose() {
      resized.disconnect();
      game.dispose();
      if (base) removeRun(base);
    },
  };
}
