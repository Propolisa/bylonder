// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// A game's physics (defineGame's `physics: 'havok'`): Babylon's Havok plugin on the run's scene, stepped by the run's
// clock in fixed steps rather than by the frame, so a seed reproduces a run in the page, the Game area, a test and a
// replay alike. Game code uses Babylon's physics API unwrapped (PhysicsAggregate, PhysicsBody) on `babylon.scene`.
import { HavokPlugin, Vector3 } from '@babylonjs/core';

/** The fixed step, in seconds. */
export const PHYSICS_STEP = 1 / 60;
/** The Havok instances made, by the function that loads them: one per page. @type {WeakMap<Function, Promise<any>>} */
const loaded = new WeakMap();

/**
 * Havok's wasm instance from `load` (`(options) => HavokPhysics(options)`), made once per loader.
 * @param {(options?: any) => Promise<any>} load @param {any} [options]
 */
export function havokFrom(load, options) {
  if (!loaded.has(load)) loaded.set(load, load(options));
  return /** @type {Promise<any>} */ (loaded.get(load));
}

/**
 * Havok on `scene`, which the run steps (`step(dt)`), not the scene's render. `onBody` hears each body made.
 * @param {import('@babylonjs/core').Scene} scene @param {any} havok @param {(body: { dispose(): void }) => void} onBody
 */
export function enablePhysics(scene, havok, onBody) {
  scene.enablePhysics(new Vector3(0, -9.81, 0), new HavokPlugin(false, havok));
  scene.physicsEnabled = false;
  const engine = /** @type {any} */ (scene.getPhysicsEngine());
  const addBody = engine.addBody.bind(engine);
  engine.addBody = (/** @type {any} */ body) => { addBody(body); onBody(body); };
  let owed = 0;
  return {
    /** Advances by `dt` seconds of the run's clock, in whole fixed steps. @param {number} dt */
    step(dt) {
      for (owed += dt; owed >= PHYSICS_STEP - 1e-9; owed -= PHYSICS_STEP) {
        scene.onBeforePhysicsObservable.notifyObservers(scene);
        engine._step(PHYSICS_STEP);
        scene.onAfterPhysicsObservable.notifyObservers(scene);
      }
    },
    dispose() { scene.disablePhysicsEngine(); },
  };
}
