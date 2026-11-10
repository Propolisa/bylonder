// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// Override of Babylon's camera parser (Camera.Parse): a camera written with Euler angles and given its quaternion once parsed, as the parser reads no rotationQuaternion, so a camera turned by quaternion keys loses its turn; goes when Babylon parses a camera's rotationQuaternion.
import { Quaternion } from '@babylonjs/core';

/**
 * Serialized cameras' quaternions written as Babylon's yaw, pitch and roll, which its parser reads.
 * @param {any[]} cameras
 */
export function eulerCameras(cameras) {
  for (const entry of cameras) {
    if (!entry.rotationQuaternion) continue;
    entry.rotation = Quaternion.FromArray(entry.rotationQuaternion).toEulerAngles().asArray();
    delete entry.rotationQuaternion;
  }
}

/**
 * A parsed camera turned by quaternion, as its animation turns it.
 * @param {import('@babylonjs/core').Camera & { rotation: import('@babylonjs/core').Vector3, rotationQuaternion: Quaternion | null }} camera
 */
export function turnByQuaternion(camera) {
  camera.rotationQuaternion = Quaternion.FromEulerVector(camera.rotation);
}
