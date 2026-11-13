// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// The character's 'default' input: arrows or WASD move it on the ground as the camera sees it, Shift runs, Space jumps;
// on a touch screen a stick on the left half moves it (pushed far, it runs) and a tap on the right half jumps.
import { Vector3 } from '@babylonjs/core';
import { VirtualJoystick } from '@babylonjs/core/Misc/virtualJoystick.js';
import { DEFAULT_SPEEDS } from './movement.js';

const KEYS = { forward: ['KeyW', 'ArrowUp'], back: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
  run: ['ShiftLeft', 'ShiftRight'], jump: ['Space'] };
const AHEAD = { left: new Vector3(0, 0, 1), right: new Vector3(0, 0, -1) };

/**
 * The 'default' input of a character, as a function giving its intent each frame.
 * @param {import('./api.js').Character} character
 * @returns {(() => import('./api.js').Intent) & { dispose(): void }}
 */
export function defaultInput(character) {
  const held = new Set(), intent = { move: new Vector3(), jump: false }, forward = new Vector3(), right = new Vector3();
  let tapped = false;
  const down = (/** @type {KeyboardEvent} */ e) => held.add(e.code), up = (/** @type {KeyboardEvent} */ e) => held.delete(e.code);
  const blur = () => held.clear();
  const touch = (/** @type {PointerEvent} */ e) => { if (e.pointerType === 'touch' && e.clientX > innerWidth / 2) tapped = true; };
  const stick = globalThis.matchMedia?.('(pointer: coarse)').matches ? new VirtualJoystick(true, { limitToContainer: true }) : null;
  globalThis.addEventListener?.('keydown', down);
  globalThis.addEventListener?.('keyup', up);
  globalThis.addEventListener?.('blur', blur);
  globalThis.addEventListener?.('pointerdown', touch);
  const any = (/** @type {string[]} */ codes) => (codes.some((c) => held.has(c)) ? 1 : 0);

  const input = () => {
    let x = any(KEYS.right) - any(KEYS.left), z = any(KEYS.forward) - any(KEYS.back), run = any(KEYS.run) > 0;
    if (stick?.pressed) {
      x = stick.deltaPosition.x * 2;
      z = stick.deltaPosition.y * 2;
      run = Math.hypot(x, z) > 1.6;
    }
    const amount = Math.min(1, Math.hypot(x, z)), speeds = character.locomotion?.speeds ?? DEFAULT_SPEEDS;
    groundAxes(character.node.getScene(), forward, right);
    const speed = amount > 1e-3 ? (amount * (run ? speeds.run : speeds.walk)) / Math.hypot(x, z) : 0;
    intent.move.set((right.x * x + forward.x * z) * speed, 0, (right.z * x + forward.z * z) * speed);
    intent.jump = any(KEYS.jump) > 0 || tapped;
    tapped = false;
    return intent;
  };
  return Object.assign(input, {
    dispose() {
      globalThis.removeEventListener?.('keydown', down);
      globalThis.removeEventListener?.('keyup', up);
      globalThis.removeEventListener?.('blur', blur);
      globalThis.removeEventListener?.('pointerdown', touch);
      stick?.releaseCanvas();
    },
  });
}

/** The ground's forward and right as the scene's camera sees them (world +Z and +X without one). */
export function groundAxes(/** @type {import('@babylonjs/core').Scene} */ scene, /** @type {Vector3} */ forward, /** @type {Vector3} */ right) {
  const camera = scene.activeCamera;
  if (camera) camera.getDirectionToRef(scene.useRightHandedSystem ? AHEAD.right : AHEAD.left, forward);
  else forward.set(0, 0, 1);
  forward.y = 0;
  if (forward.lengthSquared() < 1e-8) forward.set(0, 0, 1);
  forward.normalize();
  // A quarter turn about up toward the screen's right, in either handedness.
  if (scene.useRightHandedSystem) right.set(-forward.z, 0, forward.x);
  else right.set(forward.z, 0, -forward.x);
}
