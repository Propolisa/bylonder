// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// Turning a head and eyes toward a point. The face's direction is read from the rest pose: from the head toward the
// eyes, level in the world, else the root's +Z. An eye the rig aims by a track constraint (CloudRig's TGT-Eye.L) is turned by moving
// that target, as an animator would; any other eye bone is turned itself.
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core';
import { createPoseApi } from '../pose-api.js';
import { poseBones } from './limbs.js';
import { about, angleOf, between, moveWorld, turnWorld, worldOf } from './space.js';

const ROOT = Matrix.Identity();
/** @typedef {import('../api.js').Pose} Pose @typedef {import('../api.js').Bone} Bone */

const IDENTITY = Quaternion.Identity();
const at = new Vector3(), to = new Vector3(), look = new Vector3(), turn = new Quaternion(), world = new Quaternion(), axis = new Vector3();

/** The rig at rest, under an identity root. */
export const restPose = (/** @type {any} */ rig) => createPoseApi(Float32Array.from(rig.rest), rig.parents, () => ROOT);

/**
 * The face's forward direction in `bone`'s own space, from the rest pose under the character's root: from the head
 * toward the eyes, level, else the root's +Z.
 * @param {any} character @param {Bone} head @param {Bone[]} eyes @param {Bone} bone
 */
export function forwardIn(character, head, eyes, bone) {
  const { rig } = character, root = character.node?.computeWorldMatrix(true) ?? ROOT;
  const rest = createPoseApi(Float32Array.from(rig.rest), rig.parents, () => root), forward = Vector3.TransformNormal(Vector3.Forward(), root);
  if (eyes.length) {
    worldOf(rest, head, at);
    forward.setAll(0);
    for (const eye of eyes) { worldOf(rest, eye, to); forward.addInPlace(to.subtractInPlace(at)); }
    forward.y = 0;
  }
  worldOf(rest, bone, null, world);
  return forward.normalize().rotateByQuaternionToRef(Quaternion.Inverse(world), new Vector3());
}

/** The bone's face direction in world space now, into `out`. */
export function lookOf(/** @type {Pose} */ pose, /** @type {Bone} */ bone, /** @type {Vector3} */ forward, /** @type {Vector3} */ out) {
  worldOf(pose, bone, null, world);
  return forward.rotateByQuaternionToRef(world, out);
}

/**
 * Turns `bones` (chest to head) so the last one faces `point`, by `amount`: the turn round, at most `yaw` radians, is
 * shared by the bones in `shares` of what is left, the body's each twisting about its own length (so a spine leaning
 * into a jump turns without bending sideways) and the head about the vertical; then the head alone looks up or down, to
 * at most `pitch` radians from level. Nothing rolls.
 * @param {Pose} pose @param {Bone[]} bones @param {number[]} shares @param {Vector3} forward in the last bone's space
 * @param {Vector3} point @param {{ yaw: number, pitch: number }} limits @param {number} amount
 */
export function aimChain(pose, bones, shares, forward, point, { yaw, pitch }, amount) {
  const head = bones[bones.length - 1];
  lookOf(pose, head, forward, look);
  worldOf(pose, head, at);
  point.subtractToRef(at, to);
  look.y = 0; to.y = 0;
  const round = Math.atan2(Vector3.CrossToRef(look, to, axis).y, Vector3.Dot(look, to));
  const total = Math.max(-yaw, Math.min(yaw, round)) * amount;
  let left = 1;
  for (let k = 0; k < bones.length; k++) {
    const share = shares[k] * left;
    left -= share;
    if (bones[k] === head) axis.copyFrom(Vector3.UpReadOnly);
    else Vector3.TransformNormalToRef(Vector3.UpReadOnly, pose.world(bones[k]), axis).normalize().scaleInPlace(axis.y < 0 ? -1 : 1);
    turnWorld(pose, bones[k], about(axis, total * share, turn));
  }
  lookOf(pose, head, forward, look).normalize();
  worldOf(pose, head, at);
  point.subtractToRef(at, to);
  const wanted = Math.max(-pitch, Math.min(pitch, Math.atan2(to.y, Math.hypot(to.x, to.z))));
  const level = Math.hypot(look.x, look.z) || 1, now = Math.asin(Math.max(-1, Math.min(1, look.y)));
  const tilted = now + (wanted - now) * amount;
  to.set(look.x / level * Math.cos(tilted), Math.sin(tilted), look.z / level * Math.cos(tilted));
  turnWorld(pose, head, between(look, to, turn));
}

/**
 * An eye: `lookAt` turns it toward a point within `limit` of the head's face, `glance` turns it by small angles.
 * @param {any} character @param {Bone} eye @param {Bone} head @param {Bone[]} eyes both eyes, which set the face's direction
 */
export function createEye(character, eye, head, eyes) {
  const { rig } = character, bones = poseBones(character), name = rig.names[eye];
  // A track constraint on the eye or a child of it: its target is what the rig turns the eye by.
  let target = -1;
  for (const b of bones.values()) {
    const parent = b.parent?.struct?.match(/^pose\.bones\["(.*)"\]$/)?.[1];
    if (b.name !== name && parent !== name) continue;
    const track = (b.constraints ?? []).find((/** @type {any} */ c) => /^(DAMPED_TRACK|TRACK_TO|LOCKED_TRACK)$/.test(c.type) && c.subtarget);
    if (track) target = rig.boneIndex(track.subtarget);
    if (target >= 0) break;
  }
  const forward = forwardIn(character, head, eyes, eye), headForward = forwardIn(character, head, eyes, head), face = new Vector3(), toward = new Vector3(), axis = new Vector3();
  return {
    /** The rig's eye target, if it has one. */
    target,
    /** Turns the eye toward `point` by `amount`, at most `limit` radians off the face. */
    lookAt(/** @type {Pose} */ pose, /** @type {Vector3} */ point, /** @type {number} */ amount, limit = 0.6) {
      worldOf(pose, eye, at);
      lookOf(pose, head, headForward, face);
      point.subtractToRef(at, toward);
      const distance = toward.length();
      toward.scaleInPlace(1 / (distance || 1));
      between(face, toward, turn);
      const angle = angleOf(turn);
      if (angle > limit) { Quaternion.SlerpToRef(IDENTITY, turn, limit / angle, turn); face.rotateByQuaternionToRef(turn, toward); }
      if (target >= 0) {
        worldOf(pose, target, to);
        at.addInPlace(toward.scaleInPlace(Math.max(distance, 0.3))).subtractInPlace(to).scaleInPlace(amount);
        moveWorld(pose, target, at);
      } else {
        lookOf(pose, eye, forward, look);
        turnWorld(pose, eye, between(look, toward, turn), amount);
      }
    },
    /** Turns the eye by `yaw` and `pitch` radians about the head's up and side. */
    glance(/** @type {Pose} */ pose, /** @type {number} */ yaw, /** @type {number} */ pitch) {
      lookOf(pose, head, headForward, face);
      worldOf(pose, eye, at);
      if (target >= 0) {
        worldOf(pose, target, to);
        const distance = Vector3.Distance(at, to);
        Vector3.CrossToRef(Vector3.UpReadOnly, face, axis).normalize();
        moveWorld(pose, target, toward.copyFrom(axis).scaleInPlace(yaw * distance).addInPlaceFromFloats(0, -pitch * distance, 0));
      } else {
        turnWorld(pose, eye, about(Vector3.UpReadOnly, yaw, turn));
        Vector3.CrossToRef(Vector3.UpReadOnly, face, axis).normalize();
        turnWorld(pose, eye, about(axis, pitch, turn));
      }
    },
  };
}
