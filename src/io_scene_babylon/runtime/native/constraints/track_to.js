// @ts-nocheck
// SPDX-License-Identifier: MIT OR Apache-2.0
// From babylon-blender-rig (scripts/native-rig.mjs).
import { col, cross, dot, len, normalize, scaleV, sub, translation, fromCols, scaleOf } from '../math.js';

const TRACK = {
  TRACK_X: [0, 1], TRACK_Y: [1, 1], TRACK_Z: [2, 1],
  TRACK_NEGATIVE_X: [0, -1], TRACK_NEGATIVE_Y: [1, -1], TRACK_NEGATIVE_Z: [2, -1],
};
const UP = { UP_X: 0, UP_Y: 1, UP_Z: 2 };
const project = (w, v) => sub(w, scaleV(v, dot(v, w)));

// TRACK_TO (specs/track_to.md): the track axis points at the target, the up axis toward world (or target) Z.
export default {
  type: 'TRACK_TO',
  targets: 'one',
  defaults: { track_axis: 'TRACK_NEGATIVE_Z', up_axis: 'UP_Y', use_target_z: false },
  evaluate(owner, target, s) {
    const [ti, sg] = TRACK[s.track_axis] ?? TRACK.TRACK_NEGATIVE_Z, ui = UP[s.up_axis] ?? 1;
    if (ti === ui) return null;
    const d = sub(translation(target), translation(owner));
    if (!len(d)) return null;
    const v = scaleV(normalize(d), sg);
    const w = s.use_target_z ? normalize(col(target, 2)) : [0, 0, 1];
    let u = project(w, v);
    if (len(u) < 1e-6) u = project([0, 1, 0], v);
    u = normalize(u);
    const cols = [];
    cols[ti] = v; cols[ui] = u;
    const k = 3 - ti - ui;
    cols[k] = cross(cols[(k + 1) % 3], cols[(k + 2) % 3]);
    const sc = scaleOf(owner);
    return fromCols(scaleV(cols[0], sc[0]), scaleV(cols[1], sc[1]), scaleV(cols[2], sc[2]), translation(owner));
  },
};
