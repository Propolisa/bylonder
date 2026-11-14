// The Game area (docs/data-flow.md, Play mode), Bylonder's own editor: the scene as File > Export > JavaScript ships it,
// run by the exported page's own runtime (load, BlendScene). Its tables are the live package's (package-preview.js):
// each edit, undo or redo reaches the game as a patch, one way, from Main; nothing the game runs holds Main or the
// authoring scene. Pause holds the game's frame; Reset loads the package again, patched to the tables as they are now.
import { createApp, h, reactive } from 'vue';
import GameView from './GameView.vue';
import { createPackagePreview, previewPage } from '../space_package/package-preview.js';
import { tablesPatch } from '../../io_scene_babylon/scene-patch.js';
import { packagedFiles } from '../../io_scene_babylon/export.js';
import { exportOptions } from '../../io_scene_babylon/export-options.js';
import { publishFiles, removeRun } from '../../workspace/module-host.js';
import { registerOperator } from '../../windowmanager/wm-operators.js';

export function mountGameView(section, { world }) {
  const state = reactive({ url: '', status: '', busy: false, running: false, paused: false });
  // WebGL 2 until exported pages draw on WebGPU again (the area light and environment fixes in progress).
  const options = exportOptions({ controlPanel: false, target: 'WEBGL2' });
  const channel = `bylonder-game:${crypto.randomUUID()}`, messages = new BroadcastChannel(channel);
  // The tables the page's module was written with, which Reset patches to the live ones.
  let published = null;
  const report = (status) => { state.status = status; };
  const preview = createPackagePreview({
    world, options, report, post: (patch) => messages.postMessage({ patch }),
    publish: async (files) => {
      const page = { ...(await packagedFiles(files, options)), 'index.html': new TextEncoder().encode(previewPage(channel)) };
      if (state.url) await removeRun(state.url.slice(0, state.url.lastIndexOf('/') + 1));
      return `${await publishFiles(page)}index.html`;
    },
  });
  const run = (label, fn) => async () => {
    state.busy = true;
    try { await fn(); } catch (error) { report(`${label} failed: ${error.message}`); } finally { state.busy = false; }
  };
  const pause = () => {
    state.paused = !state.paused;
    messages.postMessage({ paused: state.paused });
    report(state.paused ? 'Paused' : 'Playing');
  };
  const play = run('Play', async () => {
    if (state.running) { pause(); return; }
    state.url = await preview.reload();
    published = preview.state;
    Object.assign(state, { running: true, paused: false });
    report('Playing');
  });
  const reset = run('Reset', async () => {
    await preview.settled();
    messages.postMessage({ reset: tablesPatch(published, preview.state) });
    state.paused = false;
    report('Reset');
  });
  registerOperator('bylonder.game_play', { poll: () => !state.busy, run: play });
  registerOperator('bylonder.game_pause', { poll: () => state.running, run: pause });
  registerOperator('bylonder.game_reset', { poll: () => state.running && !state.busy, run: reset });
  createApp({ render: () => h(GameView, { ...state, onPlay: play, onPause: pause, onReset: reset }) }).mount(section);
  return {
    changed: () => state.running && preview.changed(),
    settled: () => preview.settled(),
    dispose() { messages.close(); if (state.url) removeRun(state.url.slice(0, state.url.lastIndexOf('/') + 1)); },
  };
}
