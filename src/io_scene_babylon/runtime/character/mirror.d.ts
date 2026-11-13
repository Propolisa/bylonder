/**
 * A function mirroring poses of `rig` in place.
 * @param {{ names: string[], parents: Int32Array, rest: Float32Array }} rig
 * @returns {(pose: Float32Array) => void}
 */
export function mirrorPose({ names, parents, rest }: {
    names: string[];
    parents: Int32Array;
    rest: Float32Array;
}): (pose: Float32Array) => void;
