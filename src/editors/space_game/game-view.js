// The Game area (docs/data-flow.md, From .blend to the game views), Bylonder's own editor: the scene as File > Export >
// JavaScript ships it, run by the exported page's own runtime (load, BlendScene) in the app's module graph
// (game-run.js), on an engine of its own on the area's canvas, made as the page makes it (scene.js createEngine). Its tables are the live package's (package-preview.js): each edit, undo or redo reaches
// the game as a patch, one way, from Main; nothing the game runs writes into Main or the live package, which it holds
// frozen. Pause holds the game's frame; Reset drops the run and loads the live version again; Stop ends it and frees
// its engine. Play takes the area into Focus Mode (`fullscreen`), and the game draws only while its area is shown.
import * as core from '@babylonjs/core';
import { createApp, h, reactive } from 'vue';
import GameView from './GameView.vue';
import { createGameRun } from './game-run.js';
import { createPackagePreview } from '../space_package/package-preview.js';
import { packagedFiles } from '../../io_scene_babylon/export.js';
import { exportOptions } from '../../io_scene_babylon/export-options.js';
import { EVALUATIONS, exportEvaluation, setExportEvaluation } from '../../io_scene_babylon/export-settings.js';
import { sharedStatus } from '../../io_scene_babylon/runtime/shared-resources.js';
import { publishFiles, removeRun, RUN_CACHE } from '../../workspace/module-host.js';
import { registerOperator } from '../../windowmanager/wm-operators.js';
import { runGame } from '../../io_scene_babylon/runtime/game/run.js';
import { createGameCode, errorAt } from './game-code.js';
import { renderSettings } from '../../workspace/render-settings.js';
import { areaRenderLoop, watchShown } from '../screen/area-shown.js';
import { audioContext } from '../../io_scene_babylon/runtime/character/sound.js';

/** The engine at the Viewport resolution set in the app, if any (renderSettings), else as made. */
const scaled = (engine) => { const { mode, ratio } = renderSettings(); if (mode === 'custom') engine.setHardwareScalingLevel(ratio); return engine; };

// The app's modules a package's scene.js imports (runtime-files.js appSource), by src/ path.
const sources = import.meta.glob(['../../io_scene_babylon/runtime/**/*.js', '../../overrides/**/*.js', '../../blenkernel/light/area-specular.js', '../../compositor/fog-glow.js',
  '../../io_scene_babylon/panel-icons.js', '../../io_scene_babylon/polyfill/volumes.js', '../../draw/curves-blocks.js', '../../draw/pointcloud.js']);
// Havok (@babylonjs/havok, MIT) for a game with physics: the app's own copy, its wasm fetched on the first such run.
const havok = () => import('@babylonjs/havok').then((m) => m.default());
const appModule = (source) => (source === '@babylonjs/core' ? core : sources[`../../${source}`]());

export function mountGameView(section, { world, header, run: files, codeError, fullscreen }) {
  const state = reactive({ status: '', shared: '', busy: false, running: false, paused: false, evaluation: exportEvaluation(world) });
  // On the app's own engine kind, WebGPU or WebGL 2, so a rig the native runtime deforms computes where the app does.
  // A project with game code gets its actions as clips too, which behaviours play (entity.play). Never bundled: the run
  // links scene.js to the app's own modules (package-link.js), so a bundle would only cost time.
  const hasGameCode = !!files?.files.some((path) => /^src\/.+\.m?js$/.test(path));
  // Its project too, whose game may run physics: then the rigid bodies are the game's to simulate, not baked.
  const project = hasGameCode && { files: files.files, read: async (path) => new Uint8Array(await (await fetch(files.root + path)).arrayBuffer()) };
  const options = { ...exportOptions({ controlPanel: false, target: world.scene.getEngine().isWebGPU ? 'WEBGPU' : 'WEBGL2', bundle: false, ...(hasGameCode && { animations: 'BOTH' }) }), ...(project && { project }) };
  // Each run draws on a canvas of its own, so a stopped run's drawing context goes with it.
  const newCanvas = () => {
    const made = Object.assign(document.createElement('canvas'), { className: 'block h-full w-full outline-none', tabIndex: 0 });
    // Keys typed into the playing game are the game's, not Blender's shortcuts.
    made.dataset.gameInput = '';
    return made;
  };
  let canvas = newCanvas();
  // At the resolution the 3D View is set to (Viewport resolution), when one is set.
  const game = createGameRun({ appModule, exportAgain: () => preview.reload(), engine: async (createEngine) => scaled(await createEngine(canvas)) });
  // The area's size is the game's, as a page's canvas is its engine's.
  // The new size is taken at the start of the next frame, never between a frame's encoding and its submit, where a
  // WebGPU canvas texture the resize replaced would be submitted.
  let resize = false, unwatch = () => {};
  const render = () => {
    if (resize) { resize = false; game.engine.resize(); }
    if (!state.paused) game.blend?.scene.render();
  };
  const loop = areaRenderLoop(render, { engine: () => game.engine, wanted: () => state.running });
  const watch = () => {
    unwatch();
    const resized = new ResizeObserver(() => { resize = true; }), hidden = watchShown(canvas, loop.shown);
    resized.observe(canvas);
    unwatch = () => { resized.disconnect(); hidden(); };
  };
  watch();
  let base = null, patching = Promise.resolve();
  // What the run says, after a camera edit the game's code holds, which stays said until the camera shows an edit again.
  let said = '', held = '';
  const report = (status) => { said = status; state.status = held ? `${held}. ${status}` : status; };
  const hold = (text) => { held = text; report(said); };
  // The scene camera as the game shows it: its world matrix and field of view.
  const cameraView = () => {
    const camera = game.blend?.scene.activeCamera;
    return camera && { matrix: camera.computeWorldMatrix(true).clone(), fov: camera.fov };
  };
  const same = (a, b) => a.matrix.equalsWithEpsilon(b.matrix, 1e-5);
  // A camera edit that the game's code undoes within its next frames (a step may finish a frame late) is said, not
  // dropped silently.
  const heldCamera = (before, edited) => {
    if (!before || !edited || (same(before, edited) && before.fov === edited.fov)) return;
    let frames = 3;
    const scene = game.blend.scene, observer = scene.onAfterRenderObservable.add(() => {
      if (--frames) return;
      scene.onAfterRenderObservable.remove(observer);
      const shown = cameraView(), parts = [];
      if (!same(before, edited) && same(before, shown)) parts.push('places the camera');
      if (before.fov !== edited.fov && Math.abs(before.fov - shown.fov) < 1e-6) parts.push('sets its field of view');
      hold(parts.length ? `Camera edit not shown: the game's code ${parts.join(' and ')}` : '');
    });
  };
  // The project's game code (game-code.js) over the run: one world per loaded run, so Reset and a fresh load start it
  // fresh, while a patch keeps it; a saved file swaps its definitions in, keeping each behaviour's state.
  const publish = async (path, content) => (await caches.open(RUN_CACHE)).put(files.root + path, new Response(content, { headers: { 'Content-Type': 'text/javascript' } }));
  const code = files && createGameCode({ ...files, publish });
  // The project's files the game reads (an Ink story), served with the run's.
  const assets = files && { url: (path) => files.root + path, text: async (path) => (await fetch(files.root + path)).text() };
  let played = null;
  // The project's behaviours are loaded at once: the Behaviors panel lists them before the game plays.
  const loadingCode = code?.load().catch((error) => report(`Game code: ${error.message}`));
  const swapTimers = new Map();
  const stopGame = () => {
    played?.dispose();
    played = null;
  };
  // The page's own run (runtime/game/run.js) over the loaded scene, on the area's canvas.
  const startGame = async () => {
    const blend = game.blend;
    if (played?.blend === blend) return played.world.sync();
    if (!code || !blend) return;
    stopGame();
    await loadingCode;
    if (game.blend !== blend) return;
    const started = await runGame(blend, code, { canvas, assets, engine: game.engine, havok, paused: () => state.paused, report: (error, where) => report(`${where}: ${error?.message ?? error}`) });
    if (game.blend !== blend || played) return started.dispose();
    played = started;
    // The game's code goes before its scene does (a fresh load), while the bodies and nodes it lets go of still exist.
    blend.scene.onDisposeObservable.addOnce(() => { if (played === started) stopGame(); });
  };
  const shown = () => {
    state.shared = game.blend ? sharedStatus(game.blend.scene) : '';
    startGame().catch((error) => report(`Game code: ${error.message}`));
    loop.update();
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
    // A value edit is set on the run at once, ahead of the patches still on their way, which carry the same values.
    set: (changes) => {
      if (!state.running) return;
      const before = cameraView();
      game.set(changes);
      if (!state.paused) heldCamera(before, cameraView());
    },
    post: (patch, fresh) => {
      patching = patching.then(async () => {
        if (!state.running) return;
        if (fresh) await game.reset(preview.state);
        else if (!(await game.patch(patch, preview.state))) report('Loaded again: a patch did not apply');
        shown();
      }).catch((error) => report(`Not loaded: ${error.message}`));
    },
  });
  const run = (label, fn) => async (...args) => {
    state.busy = true;
    try { await fn(...args); } catch (error) { report(`${label} failed: ${error.message}`); } finally { state.busy = false; }
  };
  const pause = () => {
    state.paused = !state.paused;
    report(state.paused ? 'Paused' : 'Playing');
  };
  const play = run('Play', async () => {
    if (state.running) { pause(); return; }
    // At the press, while the browser still takes it as the user's: fullscreen and sound need one.
    fullscreen?.();
    audioContext()?.resume();
    await preview.reload();
    Object.assign(state, { running: true, paused: false });
    loop.update();
    report('Playing');
    // Play is the intent to play: the game takes the keys at once.
    canvas.focus();
  });
  const reset = run('Reset', async () => {
    held = '';
    await preview.settled();
    await patching;
    await game.reset(preview.state);
    shown();
    state.paused = false;
    report('Reset');
  });
  // The run, its engine (scene, physics, game code) and its files gone; the game's sound held until the next Play.
  const stop = run('Stop', async () => {
    Object.assign(state, { running: false, paused: false, shared: '' });
    held = '';
    await preview.settled();
    await patching;
    loop.update();
    stopGame();
    game.dispose();
    if (base) await removeRun(base);
    base = null;
    canvas = newCanvas();
    watch();
    audioContext()?.suspend();
    report('Stopped');
  });
  // The scene's modifier stack for packages: a structural change, which exports again and loads the game fresh.
  const evaluate = run('Modifier Stack', async (value) => {
    setExportEvaluation(world, value);
    state.evaluation = value;
    if (!state.running) return;
    const label = EVALUATIONS.find(([id]) => id === value)[1];
    report(`Exporting with the ${label} stack`);
    await preview.settled();
    await patching;
    await preview.reload();
    state.paused = false;
    report(`Loaded fresh with the ${label} stack`);
  });
  registerOperator('bylonder.game_play', { poll: () => !state.busy, run: play });
  registerOperator('bylonder.game_pause', { poll: () => state.running, run: pause });
  registerOperator('bylonder.game_stop', { poll: () => state.running && !state.busy, run: stop });
  registerOperator('bylonder.game_reset', { poll: () => state.running && !state.busy, run: reset });
  createApp({ render: () => h(GameView, { ...state, evaluations: EVALUATIONS, header, canvas, onPlay: play, onPause: pause, onStop: stop, onReset: reset, onEvaluation: evaluate }) }).mount(section);
  return {
    changed: () => {
      state.evaluation = exportEvaluation(world);
      if (state.running || state.busy) preview.changed();
    },
    settled: async () => { await preview.settled(); await patching; },
    get blend() { return game.blend; },
    /** The game's engine while it plays, and whether it draws (its area shown). */
    get engine() { return game.engine; },
    get drawing() { return loop.running; },
    /** The game's world while it plays (game/world.js). */
    get world() { return played?.world ?? null; },
    /** The project's game code (game-code.js), and when it is first loaded. */
    code,
    codeReady: loadingCode,
    /** A project file edited: game code is swapped into the playing game once typing pauses, keeping state. */
    codeChanged(path, content) {
      if (!code) return;
      clearTimeout(swapTimers.get(path));
      swapTimers.set(path, setTimeout(async () => {
        // A version that does not load or whose create throws never replaces the running one; its error shows here and
        // on its line in the code editor until a version runs.
        const failed = (error) => {
          report(`${path}: ${error?.message ?? error}`);
          codeError?.({ path, message: String(error?.message ?? error), ...errorAt(error, path) });
        };
        try {
          const next = await code.candidate(path, content);
          if (!next) return;
          const errors = played ? played.world.swap(next.behaviors, next.game) : [];
          if (errors.length) return failed(errors[0]);
          next.accept();
          codeError?.({ path, message: null });
          report(`Swapped in ${path}`);
        } catch (error) {
          failed(error);
        }
      }, 600));
    },
    dispose() {
      stopGame();
      unwatch();
      loop.update();
      game.dispose();
      if (base) removeRun(base);
    },
  };
}
