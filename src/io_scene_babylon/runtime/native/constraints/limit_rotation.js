// @ts-nocheck
// SPDX-License-Identifier: MIT OR Apache-2.0
// From babylon-blender-rig (scripts/native-rig.mjs).
import { mul, diag, scaleOf, normalizedCols, fixShear, setTranslation, translation, eulerMatrix } from '../math.js';
import { eulerOf } from '../euler.js';

const EULER_ORDERS = ['XYZ', 'XZY', 'YXZ', 'YZX', 'ZXY', 'ZYX'];
const TAU = 2 * Math.PI;
const mod = (a) => ((a % TAU) + TAU) % TAU;

// New behaviour: wrap into [mid - pi, mid + pi], then go to the boundary closer around the circle.
function limitAngle(e, lo, hi) {
  const mid = (lo + hi) / 2;
  e -= TAU * Math.round((e - mid) / TAU);
  if (e >= lo && e <= hi) return e;
  return mod(lo - e) < mod(e - hi) ? lo : hi;
}

// LIMIT_ROTATION (specs/limit_rotation.md).
export default {
  type: 'LIMIT_ROTATION',
  targets: 'none',
  defaults: {
    use_limit_x: false, use_limit_y: false, use_limit_z: false,
    min_x: 0, max_x: 0, min_y: 0, max_y: 0, min_z: 0, max_z: 0, euler_order: 'AUTO', use_legacy_behavior: false,
  },
  evaluate(owner, _target, s, spaces) {
    const order = s.euler_order !== 'AUTO' ? s.euler_order
      : EULER_ORDERS.includes(spaces.rotationMode) ? spaces.rotationMode : 'XYZ';
    const f = fixShear(owner), s0 = scaleOf(f);
    const e = eulerOf(normalizedCols(f), order);
    ['x', 'y', 'z'].forEach((a, i) => {
      if (!s[`use_limit_${a}`]) return;
      const lo = s[`min_${a}`], hi = s[`max_${a}`];
      e[i] = s.use_legacy_behavior ? Math.min(hi, Math.max(lo, e[i])) : limitAngle(e[i], lo, hi);
    });
    return setTranslation(mul(eulerMatrix(e, order), diag(s0)), translation(owner));
  },
};
