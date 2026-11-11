// @ts-nocheck
// SPDX-License-Identifier: MIT OR Apache-2.0
// From babylon-blender-rig (scripts/native-rig.mjs).
import { scaleOf, normalizedCols, col, sub, dot, scaleV, normalize, cross, len, translation, fromCols } from '../math.js';

const TRACK = { TRACK_X: [0, 1], TRACK_Y: [1, 1], TRACK_Z: [2, 1], TRACK_NEGATIVE_X: [0, -1], TRACK_NEGATIVE_Y: [1, -1], TRACK_NEGATIVE_Z: [2, -1] };
const LOCK = { LOCK_X: 0, LOCK_Y: 1, LOCK_Z: 2 };

// LOCKED_TRACK (specs/constraints_more.md): the track axis turns about the locked axis toward the target.
export default {
  type: 'LOCKED_TRACK',
  targets: 'one',
  defaults: { track_axis: 'TRACK_Y', lock_axis: 'LOCK_Z' },
  evaluate(owner, target, s) {
    const [ti, sg] = TRACK[s.track_axis] ?? TRACK.TRACK_Y, li = LOCK[s.lock_axis] ?? 2;
    if (ti === li) return null;
    const R = normalizedCols(owner), sc = scaleOf(owner), lock = col(R, li);
    const v = sub(translation(target), translation(owner)), p = sub(v, scaleV(lock, dot(v, lock)));
    if (len(p) < 1e-12) return null;
    const cols = [];
    cols[li] = lock;
    cols[ti] = scaleV(normalize(p), sg);
    const k = 3 - ti - li;
    cols[k] = cross(cols[(k + 1) % 3], cols[(k + 2) % 3]);
    return fromCols(scaleV(cols[0], sc[0]), scaleV(cols[1], sc[1]), scaleV(cols[2], sc[2]), translation(owner));
  },
};
