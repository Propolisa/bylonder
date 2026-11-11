// @ts-nocheck
// SPDX-License-Identifier: MIT OR Apache-2.0
// From babylon-blender-rig (scripts/native-rig.mjs).
import { split, compose } from '../math.js';

const AXIS = { SAMEVOL_X: 0, SAMEVOL_Y: 1, SAMEVOL_Z: 2 };

// MAINTAIN_VOLUME (specs/constraints_more.md): the two other axes scaled to keep the volume.
export default {
  type: 'MAINTAIN_VOLUME',
  targets: 'none',
  defaults: { free_axis: 'SAMEVOL_Y', volume: 1, mode: 'STRICT' },
  evaluate(owner, _t, st) {
    const { t, r, s } = split(owner), f = AXIS[st.free_axis] ?? 1;
    const k = st.mode === 'UNIFORM' ? Math.sqrt(st.volume / Math.abs(s[f]) ** 3)
      : st.mode === 'SINGLE_AXIS' ? Math.sqrt(st.volume / Math.abs(s[f]))
        : Math.sqrt(st.volume / Math.abs(s[0] * s[1] * s[2]));
    return compose(t, r, s.map((v, i) => (i === f ? v : v * k)));
  },
};
