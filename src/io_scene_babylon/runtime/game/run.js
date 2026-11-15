// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// A game run on a loaded scene (docs/sdk-model.md, Packaging): the project's behaviours, the built-in ones and its game
// over the BlendScene, input from the canvas's keys, stepped before each frame, gone with dispose(). The Game area, an
// exported page and Node run their games through it, so they play alike.
import { createWorld } from './world.js';
import { blendHost } from './blend-host.js';
import { createInput } from './input.js';
import Character from './character.js';
import { havokFrom } from './physics.js';

/** The behaviours the runtime brings, which a project adds to objects without writing them. */
export const BUILTINS = /** @type {import('./define.js').Behavior[]} */ (/** @type {unknown} */ ([Character]));

/** Havok's wasm instance from `load`, its wasm found among the run's files. @param {((options?: any) => Promise<any>) | undefined} load @param {import('./world.js').Assets} [assets] */
function loadHavok(load, assets) {
  if (!load) throw new Error("The game asks for physics: 'havok', and this run has no Havok to load");
  return havokFrom(load, assets && { locateFile: (/** @type {string} */ file) => assets.url(file) });
}

/**
 * Runs `code` (its behaviours and its game) on `blend`. `canvas` gives the keys; `step: false` leaves stepping to the
 * caller (a test's clock), else the run steps before each frame while `paused()` is false. A game with `physics:
 * 'havok'` loads Havok first: `havok(options)` (HavokPhysics) makes its wasm instance, else game.js's own (`code.havok`)
 * with its wasm beside the project's files.
 * @param {any} blend the loaded scene (BlendScene)
 * @param {{ behaviors: import('./define.js').Behavior[], game?: import('./define.js').GameDefinition, havok?: (options?: any) => Promise<any> }} code
 * @param {{ canvas?: EventTarget, assets?: import('./world.js').Assets, seed?: number, engine?: import('@babylonjs/core').AbstractEngine,
 *   kept?: { states?: Map<string, any>, saved?: Map<string, any> }, step?: boolean, paused?: () => boolean, report?: (error: unknown, where: string) => void,
 *   havok?: (options?: any) => Promise<any> }} [options]
 */
export async function runGame(blend, code, { canvas, assets, seed, engine, kept, step = true, paused = () => false, report, havok } = {}) {
  const physics = code.game?.physics === 'havok' ? await loadHavok(havok ?? code.havok, assets) : undefined;
  const input = createInput(code.game?.input ?? {}, canvas);
  const behaviors = [...BUILTINS.filter((b) => !code.behaviors.some((own) => own.name === b.name)), ...code.behaviors];
  const host = blendHost(blend);
  const world = createWorld({ host, behaviors, game: code.game, engine, assets, input, seed, kept, report, havok: physics });
  world.start();
  /** @type {Promise<void> | null} */
  let stepping = null, owed = 0;
  // The frame's time is owed until the step before it is done (a behaviour's step awaits).
  const observer = step ? blend.scene.onBeforeRenderObservable.add(() => {
    if (paused()) return;
    owed += blend.scene.getEngine().getDeltaTime() / 1000;
    if (stepping) return;
    const dt = owed;
    owed = 0;
    stepping = world.step(dt).finally(() => { stepping = null; });
  }) : null;
  return {
    world, input, blend, host,
    dispose() {
      if (observer) blend.scene.onBeforeRenderObservable.remove(observer);
      world.dispose();
      input.dispose();
    },
  };
}
