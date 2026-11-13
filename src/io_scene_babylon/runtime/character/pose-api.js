// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// The Pose an effect writes (api.js Pose) over a character's pose array (pose.js layout): each bone in its own space,
// and its world matrix computed from its parents on demand, so a write earlier in the same step shows at once.
// Allocates nothing per call: world matrices and scratch values are kept per bone.
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core';
import { STRIDE } from './pose.js';

const AXES = { X: new Vector3(1, 0, 0), Y: new Vector3(0, 1, 0), Z: new Vector3(0, 0, 1) };
const turn = new Quaternion(), own = new Quaternion(), at = new Vector3(), scale = new Vector3(), local = new Matrix();

/**
 * A Pose over `pose` for a rig of `parents`, its root's world matrix from `root()`.
 * @param {Float32Array} pose @param {Int32Array} parents @param {() => Matrix} root
 * @returns {import('./api.js').Pose}
 */
export function createPoseApi(pose, parents, root) {
  const worlds = Array.from(parents, () => new Matrix());
  /** @param {number} bone */
  const check = (bone) => { if (!(bone >= 0 && bone < parents.length)) throw new Error(`No bone ${bone} in the pose`); return bone * STRIDE; };
  /** @param {number} o */
  const setTurn = (o) => { pose[o + 3] = own.x; pose[o + 4] = own.y; pose[o + 5] = own.z; pose[o + 6] = own.w; };
  return {
    setRotation(bone, rotation) {
      const o = check(bone);
      own.copyFrom(rotation).normalize();
      setTurn(o);
    },
    addRotation(bone, axis, angle) {
      const o = check(bone);
      Quaternion.RotationAxisToRef(typeof axis === 'string' ? AXES[axis] : axis, angle, turn);
      own.set(pose[o + 3], pose[o + 4], pose[o + 5], pose[o + 6]);
      own.multiplyToRef(turn, own);
      own.normalize();
      setTurn(o);
    },
    setLocation(bone, location) {
      const o = check(bone);
      pose[o] = location.x; pose[o + 1] = location.y; pose[o + 2] = location.z;
    },
    addLocation(bone, offset) {
      const o = check(bone);
      pose[o] += offset.x; pose[o + 1] += offset.y; pose[o + 2] += offset.z;
    },
    setScale(bone, value) {
      const o = check(bone);
      pose[o + 7] = value.x; pose[o + 8] = value.y; pose[o + 9] = value.z;
    },
    rotation(bone, out) {
      const o = check(bone);
      return out.set(pose[o + 3], pose[o + 4], pose[o + 5], pose[o + 6]);
    },
    location(bone, out) {
      const o = check(bone);
      return out.set(pose[o], pose[o + 1], pose[o + 2]);
    },
    world(bone) {
      check(bone);
      const parent = parents[bone];
      const above = parent >= 0 ? this.world(parent) : root();
      const o = bone * STRIDE;
      at.set(pose[o], pose[o + 1], pose[o + 2]);
      own.set(pose[o + 3], pose[o + 4], pose[o + 5], pose[o + 6]);
      scale.set(pose[o + 7], pose[o + 8], pose[o + 9]);
      Matrix.ComposeToRef(scale, own, at, local);
      local.multiplyToRef(above, worlds[bone]);
      return worlds[bone];
    },
  };
}
