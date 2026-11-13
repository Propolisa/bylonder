// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// A clip as the animation graph samples it: an action's bone poses on a uniform grid of frames, in the pose layout
// (pose.js), and its pose markers in seconds. Sampling interpolates between the two nearest frames and allocates nothing.
import { STRIDE } from './pose.js';

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
export function createClip(name, fps, bones, data, markers = []) {
  const frames = data.length / (bones.length * STRIDE);
  if (!Number.isInteger(frames) || frames < 1) throw new Error(`Clip "${name}": ${data.length} values do not fit ${bones.length} bones`);
  return { name, fps, frames, duration: (frames - 1) / fps, bones: Int32Array.from(bones), data,
    markers: markers.map((m) => ({ name: m.name, time: m.frame / fps })).sort((a, b) => a.time - b.time) };
}

/**
 * Writes the clip's pose at `time` seconds (clamped to its range) into `out`, at its bones' indices; other bones are
 * left as they are.
 * @param {Clip} clip @param {number} time @param {Float32Array} out
 */
export function sampleClip(clip, time, out) {
  const at = Math.min(Math.max(time * clip.fps, 0), clip.frames - 1), f0 = Math.floor(at), f1 = Math.min(f0 + 1, clip.frames - 1), t = at - f0;
  const { bones, data } = clip, size = bones.length * STRIDE, a = f0 * size, b = f1 * size;
  for (let j = 0; j < bones.length; j++) {
    const o = bones[j] * STRIDE, ka = a + j * STRIDE, kb = b + j * STRIDE;
    for (let k = 0; k < 3; k++) {
      out[o + k] = data[ka + k] + (data[kb + k] - data[ka + k]) * t;
      out[o + 7 + k] = data[ka + 7 + k] + (data[kb + 7 + k] - data[ka + 7 + k]) * t;
    }
    const sign = data[ka + 3] * data[kb + 3] + data[ka + 4] * data[kb + 4] + data[ka + 5] * data[kb + 5] + data[ka + 6] * data[kb + 6] < 0 ? -1 : 1;
    let l = 0;
    for (let k = 3; k < 7; k++) l += (out[o + k] = data[ka + k] * (1 - t) + sign * data[kb + k] * t) ** 2;
    l = Math.sqrt(l) || 1;
    for (let k = 3; k < 7; k++) out[o + k] /= l;
  }
}

/**
 * The markers passed going from `from` to `to` seconds (wrapping past the end when `to` < `from`), as Blender's
 * timeline passes them playing: those after `from` up to and including `to`.
 * @param {Clip} clip @param {number} from @param {number} to @param {(marker: { name: string, time: number }) => void} each
 */
export function markersPassed(clip, from, to, each) {
  for (const marker of clip.markers) if (to >= from ? marker.time > from && marker.time <= to : marker.time > from || marker.time <= to) each(marker);
}
