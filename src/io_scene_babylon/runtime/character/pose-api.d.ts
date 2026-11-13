/**
 * A Pose over `pose` for a rig of `parents`, its root's world matrix from `root()`.
 * @param {Float32Array} pose @param {Int32Array} parents @param {() => Matrix} root
 * @returns {import('./api.js').Pose}
 */
export function createPoseApi(pose: Float32Array, parents: Int32Array, root: () => Matrix): import("./api.js").Pose;
import { Matrix } from '@babylonjs/core';
