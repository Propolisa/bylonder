// @ts-nocheck
// SPDX-License-Identifier: MIT OR Apache-2.0
// From babylon-blender-rig (scripts/native-rig.mjs).
import { split, compose } from '../math.js';

// LIMIT_LOCATION and LIMIT_SCALE (specs/constraints_more.md): per axis clamp up to min, then down to max.
function limiter(type, part) {
  return {
    type,
    targets: 'none',
    defaults: Object.fromEntries(['x', 'y', 'z'].flatMap((a) => [[`use_min_${a}`, false], [`use_max_${a}`, false], [`min_${a}`, 0], [`max_${a}`, 0]])),
    evaluate(owner, _t, s) {
      const p = split(owner), v = p[part];
      ['x', 'y', 'z'].forEach((a, i) => {
        if (s[`use_min_${a}`] && v[i] < s[`min_${a}`]) v[i] = s[`min_${a}`];
        if (s[`use_max_${a}`] && v[i] > s[`max_${a}`]) v[i] = s[`max_${a}`];
      });
      return compose(p.t, p.r, p.s);
    },
  };
}

export const limitLocation = limiter('LIMIT_LOCATION', 't');
export const limitScale = limiter('LIMIT_SCALE', 's');
