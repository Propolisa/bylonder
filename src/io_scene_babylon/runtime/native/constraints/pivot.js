// @ts-nocheck
// SPDX-License-Identifier: MIT OR Apache-2.0
// From babylon-blender-rig (scripts/native-rig.mjs).
import { clone, normalizedCols, translation, setTranslation, transformDir } from '../math.js';
import { eulerOf } from '../euler.js';

const RANGE = { NX: [0, -1], NY: [1, -1], NZ: [2, -1], X: [0, 1], Y: [1, 1], Z: [2, 1] };

// PIVOT (specs/constraints_more.md): the owner's rotation taken about a pivot point. Exact for unparented objects;
// for bones and parented objects the spec is open.
export default {
  type: 'PIVOT',
  targets: 'optional',
  defaults: { offset: [0, 0, 0], use_relative_location: true, rotation_range: 'NX' },
  evaluate(owner, target, s) {
    const R = normalizedCols(owner), L = translation(owner);
    if (s.rotation_range !== 'ALWAYS_ACTIVE') {
      const [a, sign] = RANGE[s.rotation_range] ?? RANGE.NX, e = eulerOf(R, 'XYZ')[a];
      if (sign < 0 ? e > 0 : e < 0) return null;
    }
    const base = target ? translation(target) : s.use_relative_location ? L : [0, 0, 0];
    const p = base.map((v, i) => v + s.offset[i]);
    const r = transformDir(R, L.map((v, i) => v - p[i]));
    return setTranslation(clone(owner), p.map((v, i) => v + r[i]));
  },
};
