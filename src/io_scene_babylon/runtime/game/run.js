// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// A game run on a loaded scene (docs/sdk-model.md, Packaging): the project's behaviours, the built-in ones and its game
// over the BlendScene, input from the canvas's keys, stepped before each frame, gone with dispose(). The Game area, an
// exported page and Node run their games through it, so they play alike.
import { createWorld } from './world.js';
import { blendHost } from './blend-host.js';
import { createInput } from './input.js';
import Character from './character.js';

/** The behaviours the runtime brings, which a project adds to objects without writing them. */
export const BUILTINS = /** @type {import('./define.js').Behavior[]} */ (/** @type {unknown} */ ([Character]));

/**
 * Runs `code` (its behaviours and its game) on `blend`. `canvas` gives the keys; `step: false` leaves stepping to the
 * caller (a test's clock), else the run steps before each frame while `paused()` is false.
 * @param {any} blend the loaded scene (BlendScene)
 * @param {{ behaviors: import('./define.js').Behavior[], game?: import('./define.js').GameDefinition }} code
 * @param {{ canvas?: EventTarget, assets?: import('./world.js').Assets, seed?: number, engine?: import('@babylonjs/core').AbstractEngine,
 *   kept?: { states?: Map<string, any>, saved?: Map<string, any> }, step?: boolean, paused?: () => boolean, report?: (error: unknown, where: string) => void }} [options]
 */
export function runGame(blend, code, { canvas, assets, seed, engine, kept, step = true, paused = () => false, report } = {}) {
  const input = createInput(code.game?.input ?? {}, canvas);
  const behaviors = [...BUILTINS.filter((b) => !code.behaviors.some((own) => own.name === b.name)), ...code.behaviors];
  const host = blendHost(blend);
  const world = createWorld({ host, behaviors, game: code.game, engine, assets, input, seed, kept, report });
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
