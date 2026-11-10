// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// Override of Babylon's camera parser (Camera.Parse): a camera written with Euler angles, which the parser reads, and its quaternion, which it leaves out and the page's parse gives it, as Euler angles of a camera looking straight up or down lose its roll (Spiral Stair's turned some degrees) and a camera turned by quaternion keys needs one; goes when Babylon parses a camera's rotationQuaternion.
import { Camera, Quaternion } from '@babylonjs/core';

/**
 * Serialized cameras' quaternions also written as Babylon's yaw, pitch and roll, for loaders that read only those.
 * @param {any[]} cameras
 */
export function eulerCameras(cameras) {
  for (const entry of cameras) if (entry.rotationQuaternion) entry.rotation = Quaternion.FromArray(entry.rotationQuaternion).toEulerAngles().asArray();
}

/**
 * Serialized cameras an animation turns by quaternion given one to turn, from their Euler angles where they have none.
 * @param {any[]} cameras @param {any[]} animationGroups
 */
export function turnedCameras(cameras, animationGroups) {
  const turned = new Set(animationGroups.flatMap((g) => g.targetedAnimations).filter((t) => t.animation.property === 'rotationQuaternion').map((t) => t.targetId));
  for (const entry of cameras) if (turned.has(entry.id)) entry.rotationQuaternion ??= Quaternion.FromEulerAngles(entry.rotation[0], entry.rotation[1], entry.rotation[2]).asArray();
}

/**
 * A serialized camera parsed as Babylon's loader parses it, with its quaternion.
 * @param {any} entry @param {import('@babylonjs/core').Scene} scene
 */
export function parseCamera(entry, scene) {
  const camera = /** @type {any} */ (Camera.Parse(entry, scene));
  if (entry.rotationQuaternion) camera.rotationQuaternion = Quaternion.FromArray(entry.rotationQuaternion);
  return camera;
}
