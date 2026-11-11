// @ts-nocheck
// SPDX-License-Identifier: MIT OR Apache-2.0
// From babylon-blender-rig (scripts/native-rig.mjs).
import { mul, scaleOf, normalizedCols, fixShear, diag, setTranslation, translation, eulerMatrix } from '../math.js';
import { eulerOf, eulerCompatible } from '../euler.js';
import { AXIS_DEFAULTS, used, sign } from './axes.js';

const EULER_ORDERS = ['XYZ', 'XZY', 'YXZ', 'YZX', 'ZXY', 'ZYX'];

// COPY_ROTATION (specs/copy_rotation.md): copies the target's rotation by Euler axes or combines rotations.
export default {
  type: 'COPY_ROTATION',
  targets: 'one',
  defaults: { ...AXIS_DEFAULTS, euler_order: 'AUTO', mix_mode: 'REPLACE' },
  evaluate(owner, target, s, spaces) {
    const order = s.euler_order !== 'AUTO' ? s.euler_order
      : EULER_ORDERS.includes(spaces.rotationMode) ? spaces.rotationMode : 'XYZ';
    const s0 = scaleOf(owner), r0 = normalizedCols(owner);
    const eo = eulerOf(r0, order);
    const et = eulerCompatible(normalizedCols(fixShear(target)), order, eo);
    const use = used(s), sg = sign(s);
    const p = [0, 1, 2].map((i) => (use[i] ? sg[i] * et[i] : 0));
    const replaced = () => [0, 1, 2].map((i) => (use[i] ? p[i] : eo[i]));
    let r;
    switch (s.mix_mode) {
      case 'ADD': r = eulerMatrix(eo.map((v, i) => v + p[i]), order); break;
      case 'BEFORE': r = mul(eulerMatrix(p, order), r0); break;
      case 'AFTER': r = mul(r0, eulerMatrix(p, order)); break;
      case 'OFFSET': {
        // Legacy: the owner's own angles on the used axes applied after, composed X, Y, Z from the left.
        const o = [0, 1, 2].map((i) => (use[i] ? eo[i] : 0));
        r = mul(eulerMatrix(replaced(), order), eulerMatrix(o, 'ZYX'));
        break;
      }
      default: r = eulerMatrix(replaced(), order);
    }
    return setTranslation(mul(r, diag(s0)), translation(owner));
  },
};

