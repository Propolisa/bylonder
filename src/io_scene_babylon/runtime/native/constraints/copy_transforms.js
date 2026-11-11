// @ts-nocheck
// SPDX-License-Identifier: MIT OR Apache-2.0
// From babylon-blender-rig (scripts/native-rig.mjs).
import { mul, transformPoint, split, compose, add, fixShearMatrix } from '../math.js';

const mulS = (a, b) => [a[0] * b[0], a[1] * b[1], a[2] * b[2]];

// COPY_TRANSFORMS (specs/copy_transforms.md): replace or combine the owner with the target's matrix.
export const MIX = {
  REPLACE: (o, t) => Float64Array.from(t),
  BEFORE_FULL: (o, t) => mul(t, o),
  AFTER_FULL: (o, t) => mul(o, t),
  BEFORE: (o, t, so, st) => compose(transformPoint(t, so.t), mul(st.r, so.r), mulS(st.s, so.s)),
  AFTER: (o, t, so, st) => compose(transformPoint(o, st.t), mul(so.r, st.r), mulS(so.s, st.s)),
  BEFORE_SPLIT: (o, t, so, st) => compose(add(st.t, so.t), mul(st.r, so.r), mulS(st.s, so.s)),
  AFTER_SPLIT: (o, t, so, st) => compose(add(so.t, st.t), mul(so.r, st.r), mulS(so.s, st.s)),
};

export default {
  type: 'COPY_TRANSFORMS',
  targets: 'one',
  defaults: { mix_mode: 'REPLACE', remove_target_shear: false },
  evaluate(owner, target, settings) {
    if (settings.remove_target_shear) target = fixShearMatrix(target);
    return (MIX[settings.mix_mode] ?? MIX.REPLACE)(owner, target, split(owner), split(target));
  },
};
