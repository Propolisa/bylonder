/** The armature's pose bones in the IR, by name, with their constraints (none without an IR: a rig made in code). */
export function poseBones(character: any): Map<string, any>;
/**
 * A limb of the character from a role's chain (root to end; its last three bones are the upper, lower and end).
 * @param {any} character @param {Bone[]} chain
 */
export function createLimb(character: any, chain: Bone[]): {
    /** The chain's full length at rest, in the rig's units. */
    length: number;
    /** The end bone as played (the FK one on a rig with both). */
    end: any;
    /** How much the limb is in IK now, 0 to 1. */
    ikWeight: () => number;
    /** The end's world position as played (from the IK control while in IK), into `out`. */
    endAt(pose: Pose, out: Vector3): Vector3;
    /** How bent the played limb is, in radians (0 straight). */
    bend(pose: Pose): number;
    /** How far the limb's end is from its root when it is bent by `angle` radians. */
    span: (angle: number) => number;
    /** How far `point` is from the limb's root, as the end is aimed (in the frame `endAt` and `ballAt` give). */
    extension(pose: Pose, point: Vector3): number;
    /** The root of the limb (the upper bone's head) in world space, into `out`. */
    rootAt(pose: Pose, out: Vector3): Vector3;
    /**
     * Moves the end toward `target` by `weight`, then turns it in world space by `rotation` (when given): through the IK
     * control by the IK weight, and the played bones by the rest. Returns how far the target is beyond full reach.
     * @param {Pose} pose @param {Vector3} target @param {number} weight @param {Quaternion | null} [rotation]
     */
    reach(pose: Pose, target: Vector3, weight: number, rotation?: Quaternion | null): number;
};
export type Pose = import("../api.js").Pose;
export type Bone = import("../api.js").Bone;
import { Vector3 } from '@babylonjs/core';
import { Quaternion } from '@babylonjs/core';
