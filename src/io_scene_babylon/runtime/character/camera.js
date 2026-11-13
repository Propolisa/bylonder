// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// A third-person camera for a character: the scene's camera orbits a point above it, starting behind it; dragging
// orbits (on a touch screen, on the right half, the stick being on the left) and the wheel zooms; it stays above the
// ground. It stays the scene's
// camera, so its look (view transform, post-processes) stays; under the exported scene's root, which turns Blender's
// Z up to Babylon's Y up, it is placed and aimed in that root's space.
import { Matrix, Vector3 } from '@babylonjs/core';

const CLEARANCE = 0.4;

/**
 * Makes the scene's active camera follow `character`, after its frame.
 * @param {import('./api.js').Character} character
 * @param {{ pitch?: number, distance?: number, height?: number, ease?: number }} [options] `pitch` above the ground,
 *   `distance` from the point it looks at, `height` of that point above the character, `ease` how fast it catches up
 */
export function followCamera(character, { pitch = 0.35, distance = 4.5, height = 1.1, ease = 6 } = {}) {
  const scene = character.node.getScene(), camera = /** @type {import('@babylonjs/core').TargetCamera} */ (scene.activeCamera);
  if (!camera?.setTarget) throw new Error('followCamera: the scene has no camera that can be aimed');
  // Aimed here alone: its own inputs (a page's attachControl) would turn it back.
  camera.detachControl();
  camera.inputs?.clear();
  camera.rotationQuaternion = /** @type {any} */ (null);
  camera.minZ = Math.min(camera.minZ, 0.05);
  const { position, facing } = character.movement;
  const orbit = { yaw: Math.atan2(-facing.x, -facing.z), pitch, distance };
  const look = position.add(new Vector3(0, height, 0)), at = new Vector3(), toParent = new Matrix(), local = new Vector3();
  const place = (/** @type {number} */ dt) => {
    look.x += (position.x - look.x) * Math.min(1, ease * dt);
    look.y += (position.y + height - look.y) * Math.min(1, ease * dt);
    look.z += (position.z - look.z) * Math.min(1, ease * dt);
    const flat = Math.cos(orbit.pitch) * orbit.distance;
    at.set(look.x + Math.sin(orbit.yaw) * flat, look.y + Math.sin(orbit.pitch) * orbit.distance, look.z + Math.cos(orbit.yaw) * flat);
    // Never under the ground behind the character (a hill): raised above it.
    const under = character.movement.ground(at.x, at.z, at.y + 2);
    if (under && at.y < under.height + CLEARANCE) at.y = under.height + CLEARANCE;
    if (camera.parent) camera.parent.computeWorldMatrix(true).invertToRef(toParent);
    else toParent.copyFrom(Matrix.IdentityReadOnly);
    Vector3.TransformCoordinatesToRef(at, toParent, camera.position);
    Vector3.TransformNormalFromFloatsToRef(0, 1, 0, toParent, camera.upVector);
    camera.setTarget(Vector3.TransformCoordinatesToRef(look, toParent, local));
  };
  place(0);
  // On the character's clock, after its frame.
  const following = scene.onBeforeRenderObservable.add(() => place(/** @type {any} */ (character).dt ?? 0));

  const canvas = scene.getEngine().getRenderingCanvas();
  /** @type {[number, number] | null} */
  let dragging = null;
  const down = (/** @type {PointerEvent} */ e) => { if (e.pointerType !== 'touch' || e.clientX > innerWidth / 2) dragging = [e.clientX, e.clientY]; };
  const up = () => { dragging = null; };
  const move = (/** @type {PointerEvent} */ e) => {
    if (!dragging) return;
    orbit.yaw -= (e.clientX - dragging[0]) * 0.005;
    orbit.pitch = Math.min(1.2, Math.max(0.05, orbit.pitch + (e.clientY - dragging[1]) * 0.004));
    dragging = [e.clientX, e.clientY];
  };
  const zoom = (/** @type {WheelEvent} */ e) => { orbit.distance = Math.min(12, Math.max(1.5, orbit.distance * (1 + e.deltaY * 0.001))); };
  canvas?.addEventListener('pointerdown', down);
  globalThis.addEventListener?.('pointerup', up);
  globalThis.addEventListener?.('pointermove', move);
  canvas?.addEventListener('wheel', zoom, { passive: true });
  scene.onDisposeObservable.addOnce(() => {
    following?.remove();
    canvas?.removeEventListener('pointerdown', down);
    globalThis.removeEventListener?.('pointerup', up);
    globalThis.removeEventListener?.('pointermove', move);
    canvas?.removeEventListener('wheel', zoom);
  });
  return orbit;
}
