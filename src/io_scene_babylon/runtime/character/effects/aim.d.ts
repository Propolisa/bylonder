/**
 * The face's forward direction in `bone`'s own space, from the rest pose under the character's root: from the head
 * toward the eyes, level, else the root's +Z.
 * @param {any} character @param {Bone} head @param {Bone[]} eyes @param {Bone} bone
 */
export function forwardIn(character: any, head: Bone, eyes: Bone[], bone: Bone): Vector3;
/** The bone's face direction in world space now, into `out`. */
export function lookOf(pose: Pose, bone: Bone, forward: Vector3, out: Vector3): Vector3;
/**
 * Turns `bones` (chest to head) so the last one faces `point`, by `amount`: the turn round, at most `yaw` radians, is
 * shared by the bones in `shares` of what is left, the body's each twisting about its own length (so a spine leaning
 * into a jump turns without bending sideways) and the head about the vertical; then the head alone looks up or down, to
 * at most `pitch` radians from level. Nothing rolls.
 * @param {Pose} pose @param {Bone[]} bones @param {number[]} shares @param {Vector3} forward in the last bone's space
 * @param {Vector3} point @param {{ yaw: number, pitch: number }} limits @param {number} amount
 */
export function aimChain(pose: Pose, bones: Bone[], shares: number[], forward: Vector3, point: Vector3, { yaw, pitch }: {
    yaw: number;
    pitch: number;
}, amount: number): void;
/**
 * An eye: `lookAt` turns it toward a point within `limit` of the head's face, `glance` turns it by small angles.
 * @param {any} character @param {Bone} eye @param {Bone} head @param {Bone[]} eyes both eyes, which set the face's direction
 */
export function createEye(character: any, eye: Bone, head: Bone, eyes: Bone[]): {
    /** The rig's eye target, if it has one. */
    target: number;
    /** Turns the eye toward `point` by `amount`, at most `limit` radians off the face. */
    lookAt(pose: Pose, point: Vector3, amount: number, limit?: number): void;
    /** Turns the eye by `yaw` and `pitch` radians about the head's up and side. */
    glance(pose: Pose, yaw: number, pitch: number): void;
};
export function restPose(rig: any): import("../api.js").Pose;
export type Pose = import("../api.js").Pose;
export type Bone = import("../api.js").Bone;
import { Vector3 } from '@babylonjs/core';
