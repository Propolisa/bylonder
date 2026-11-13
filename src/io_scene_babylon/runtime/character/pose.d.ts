/** A pose of `count` bones, each at identity. @param {number} count */
export function createPose(count: number): Float32Array<ArrayBuffer>;
/**
 * `out` = `a` blended towards `b` by `w` per bone (times `mask[i]` when given): locations and scales linearly,
 * rotations by normalized lerp on the nearer hemisphere. `out` may be `a` or `b`.
 * @param {Float32Array} out @param {Float32Array} a @param {Float32Array} b @param {number} w @param {Float32Array | null} [mask]
 */
export function blendPoses(out: Float32Array, a: Float32Array, b: Float32Array, w: number, mask?: Float32Array | null): void;
/** Bone `i` of `out` = bone `i` of `a` blended toward `b`'s by `t` (as blendPoses does). */
export function blendBone(out: Float32Array, a: Float32Array, b: Float32Array, i: number, t: number): void;
/**
 * Accumulates `b` into `out` with weight `w`, for blending several poses by weights that sum to 1: start from zeros
 * (`clearPose`), accumulate each, then `finishPose`. Rotations are summed on `out`'s hemisphere, or the first one's.
 * @param {Float32Array} out @param {Float32Array} b @param {number} w
 */
export function accumulatePose(out: Float32Array, b: Float32Array, w: number): void;
/** Normalizes an accumulated pose's rotations. @param {Float32Array} out */
export function finishPose(out: Float32Array): void;
/**
 * Adds an additive pose (`delta`: each bone's change from a reference, location added, rotation multiplied after,
 * scale multiplied) to `out` with weight `w` per bone (times `mask[i]`).
 * @param {Float32Array} out @param {Float32Array} delta @param {number} w @param {Float32Array | null} [mask]
 */
export function addPose(out: Float32Array, delta: Float32Array, w: number, mask?: Float32Array | null): void;
/**
 * `out` = `pose` as a delta from `reference` (location difference, rotation inverse(reference) * pose, scale ratio).
 * @param {Float32Array} out @param {Float32Array} pose @param {Float32Array} reference
 */
export function deltaPose(out: Float32Array, pose: Float32Array, reference: Float32Array): void;
/**
 * The largest difference between two poses: location in the rig's units and rotation angle in radians, over all bones.
 * @param {Float32Array} a @param {Float32Array} b
 */
export function poseDistance(a: Float32Array, b: Float32Array): {
    move: number;
    turn: number;
};
export const STRIDE: 10;
export function clearPose(out: Float32Array): Float32Array<ArrayBufferLike>;
