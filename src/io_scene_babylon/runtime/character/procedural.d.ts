/**
 * The pose in world space, kept in step with a local pose.
 * @param {Skeleton} skeleton
 */
export function createWorldPose({ parents }: Skeleton): {
    position: Float32Array<ArrayBuffer>;
    rotation: Float32Array<ArrayBuffer>;
    root: {
        position: number[];
        rotation: number[];
        scale: number;
    };
    /** Places every bone from `pose` (parents come before children). @param {Float32Array} pose */
    update(pose: Float32Array): void;
};
/**
 * The ground speed a locomotion clip's feet imply: while a foot is planted it moves backwards at the speed the body
 * moves forwards, in the rig's units per second.
 * @param {import('./clip.js').Clip} clip @param {Skeleton & { rest: Float32Array }} skeleton @param {number[]} feet bone indices
 */
export function clipSpeed(clip: import("./clip.js").Clip, skeleton: Skeleton & {
    rest: Float32Array;
}, feet: number[]): number;
export type Skeleton = {
    names: string[];
    parents: Int32Array;
};
