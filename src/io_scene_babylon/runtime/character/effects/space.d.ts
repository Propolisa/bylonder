/** The bone's world position and rotation into `position` and `rotation` (either may be null). */
export function worldOf(pose: Pose, bone: Bone, position: Vector3 | null, rotation?: Quaternion | null): void;
/** Turns `bone` in world space by `turn` (applied after its world rotation), scaled toward identity by `amount`. */
export function turnWorld(pose: Pose, bone: Bone, turn: Quaternion, amount?: number): void;
/** Moves `bone` by a world-space `offset`, written as a change of its local location. */
export function moveWorld(pose: Pose, bone: Bone, offset: Vector3): void;
/** The rotation taking unit direction `from` onto unit direction `to`, into `out`. */
export function between(from: Vector3, to: Vector3, out: Quaternion): Quaternion;
/** Moves `value` toward `target` by a critically damped spring of `halfLife` seconds; `state` holds [value, velocity]. */
export function damp(state: Float32Array | number[], i: number, target: number, halfLife: number, dt: number): number;
/** The character's facing, unit and level, into `out`. */
export function facing(character: any, out: Vector3): Vector3;
export function about(axis: Vector3, angle: number, out: Quaternion): Quaternion;
export function angleOf(q: Quaternion): number;
export type Pose = import("../api.js").Pose;
export type Bone = import("../api.js").Bone;
import { Vector3 } from '@babylonjs/core';
import { Quaternion } from '@babylonjs/core';
