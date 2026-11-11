// @ts-nocheck
// SPDX-License-Identifier: MIT OR Apache-2.0
// From babylon-blender-rig (scripts/native-rig.mjs).
import { clone, sub, add, len, scaleV, translation, setTranslation } from '../math.js';

// LIMIT_DISTANCE (specs/limit_distance.md): keeps the owner inside, outside or on a sphere around the target.
export default {
  type: 'LIMIT_DISTANCE',
  targets: 'one',
  defaults: { distance: 0, limit_mode: 'LIMITDIST_INSIDE' },
  evaluate(owner, target, s, spaces) {
    const tt = translation(target), v = sub(translation(owner), tt), L = len(v);
    if (!s.distance) { spaces.store('distance', L); return null; }
    if (!L) return null;
    const move = s.limit_mode === 'LIMITDIST_ONSURFACE' || (s.limit_mode === 'LIMITDIST_OUTSIDE' ? L < s.distance : L > s.distance);
    return move ? setTranslation(clone(owner), add(tt, scaleV(v, s.distance / L))) : null;
  },
};
