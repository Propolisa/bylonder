/**
 * @typedef {{ name: string, fps: number, frames: number, duration: number, bones: Int32Array, data: Float32Array,
 *   markers: { name: string, time: number }[] }} Clip
 * @typedef {{ name: string, time: number, clip: Clip, pose: Float32Array, markers: { name: string, time: number }[] }} Action
 * @typedef {{ track: Float32Array, moves: boolean, top: number }} Track per frame the top bone's ground move (along
 *   the two axes) and turn from its first frame
 */
/**
 * The root motion of a character's body actions.
 * @param {import('./api.js').Character & { rig: import('./rig.js').Rig, body: { source: unknown, warpTo?: any } }} character
 */
export function createRootMotion(character: import("./api.js").Character & {
    rig: import("./rig.js").Rig;
    body: {
        source: unknown;
        warpTo?: any;
    };
}): {
    /** Moves the root by the body's action this frame and takes that motion out of its pose. @param {number} dt */
    update(dt: number): void;
};
export type Clip = {
    name: string;
    fps: number;
    frames: number;
    duration: number;
    bones: Int32Array;
    data: Float32Array;
    markers: {
        name: string;
        time: number;
    }[];
};
export type Action = {
    name: string;
    time: number;
    clip: Clip;
    pose: Float32Array;
    markers: {
        name: string;
        time: number;
    }[];
};
/**
 * per frame the top bone's ground move (along
 * the two axes) and turn from its first frame
 */
export type Track = {
    track: Float32Array;
    moves: boolean;
    top: number;
};
