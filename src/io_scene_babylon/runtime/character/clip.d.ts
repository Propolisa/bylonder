/**
 * @typedef {{ name: string, fps: number, frames: number, duration: number, bones: Int32Array, data: Float32Array,
 *   markers: { name: string, time: number }[], properties?: Record<string, number | number[]> | null }} Clip
 * `properties`: the rig's custom properties the clip's action keys, by control path, a value per frame or one.
 */
/**
 * A clip from its frames: `bones`, the rig's indices of the bones it sets; `data`, per frame and per bone of `bones`
 * STRIDE floats; `markers` at frames from its start.
 * @param {string} name @param {number} fps @param {ArrayLike<number>} bones @param {Float32Array} data
 * @param {{ name: string, frame: number }[]} [markers]
 * @returns {Clip}
 */
export function createClip(name: string, fps: number, bones: ArrayLike<number>, data: Float32Array, markers?: {
    name: string;
    frame: number;
}[]): Clip;
/**
 * Writes the clip's pose at `time` seconds (clamped to its range) into `out`, at its bones' indices; other bones are
 * left as they are.
 * @param {Clip} clip @param {number} time @param {Float32Array} out
 */
export function sampleClip(clip: Clip, time: number, out: Float32Array): void;
/**
 * The markers passed going from `from` to `to` seconds (wrapping past the end when `to` < `from`), as Blender's
 * timeline passes them playing: those after `from` up to and including `to`.
 * @param {Clip} clip @param {number} from @param {number} to @param {(marker: { name: string, time: number }) => void} each
 */
export function markersPassed(clip: Clip, from: number, to: number, each: (marker: {
    name: string;
    time: number;
}) => void): void;
/**
 * `properties`: the rig's custom properties the clip's action keys, by control path, a value per frame or one.
 */
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
    properties?: Record<string, number | number[]> | null;
};
