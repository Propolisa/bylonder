// @ts-nocheck
// SPDX-License-Identifier: MIT OR Apache-2.0
// From babylon-blender-rig (scripts/native-rig.mjs).
import { invert, mul } from '../math.js';
import { targetSurface, nearestSurface, nearestVertex, wrap } from '../deform/shrinkwrap.js';

// SHRINKWRAP constraint (specs/shrinkwrap.md): moves the owner's origin onto the target mesh's surface, in the
// target's own space; Track Normal turns the track axis onto the surface's smooth normal.
const TRACK = { TRACK_X: [0, 1], TRACK_Y: [1, 1], TRACK_Z: [2, 1], TRACK_NEGATIVE_X: [0, -1], TRACK_NEGATIVE_Y: [1, -1], TRACK_NEGATIVE_Z: [2, -1] };

export default {
  type: 'SHRINKWRAP',
  targets: 'one',
  defaults: { shrinkwrap_type: 'NEAREST_SURFACE', wrap_mode: 'ON_SURFACE', distance: 0, use_track_normal: false, track_axis: 'TRACK_Z' },
  compile(s, { program }) { s._target = program.objectIndex.get(s.target); },
  evaluate(owner, T, s, spaces) {
    if (s._target === undefined || !['NEAREST_SURFACE', 'NEAREST_VERTEX'].includes(s.shrinkwrap_type)) return null;
    const S = targetSurface(spaces.inst, s._target), Ti = invert(T);
    const apply = (M, p) => [0, 1, 2].map((r) => M[r] * p[0] + M[4 + r] * p[1] + M[8 + r] * p[2] + M[12 + r]);
    const p = apply(Ti, [owner[12], owner[13], owner[14]]);
    const hit = s.shrinkwrap_type === 'NEAREST_VERTEX' ? nearestVertex(S, p) : nearestSurface(S, p);
    const r = apply(T, wrap(p, hit, s.wrap_mode, s.distance));
    let out = Float64Array.from(owner);
    if (s.use_track_normal && hit.smooth) {
      // The normal to world by the inverse transpose of T's 3x3, then the shortest arc from the track axis to it.
      const n = [0, 1, 2].map((r2) => Ti[r2 * 4] * hit.smooth[0] + Ti[r2 * 4 + 1] * hit.smooth[1] + Ti[r2 * 4 + 2] * hit.smooth[2]);
      const [axis, sign] = TRACK[s.track_axis] ?? TRACK.TRACK_Z;
      out = mul(arc(unit([owner[axis * 4], owner[axis * 4 + 1], owner[axis * 4 + 2]].map((x) => x * sign)), unit(n)), out);
    }
    out[12] = r[0]; out[13] = r[1]; out[14] = r[2];
    return out;
  },
};

const unit = (v) => { const l = Math.hypot(...v) || 1; return v.map((x) => x / l); };

// Shortest-arc rotation (4x4, column-major, no translation) taking unit a to unit b.
function arc(a, b) {
  const c = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  let w = 1 + d, [x, y, z] = c;
  if (w < 1e-12) { w = 0; [x, y, z] = Math.abs(a[0]) < 0.9 ? [0, -a[2], a[1]] : [-a[1], a[0], 0]; }
  const l = Math.hypot(w, x, y, z); w /= l; x /= l; y /= l; z /= l;
  return new Float64Array([1 - 2 * (y * y + z * z), 2 * (x * y + w * z), 2 * (x * z - w * y), 0, 2 * (x * y - w * z), 1 - 2 * (x * x + z * z), 2 * (y * z + w * x), 0,
    2 * (x * z + w * y), 2 * (y * z - w * x), 1 - 2 * (x * x + y * y), 0, 0, 0, 0, 1]);
}
