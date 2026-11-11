// @ts-nocheck
// SPDX-License-Identifier: MIT OR Apache-2.0
// From babylon-blender-rig (scripts/native-rig.mjs).
import { AXIS_DEFAULTS } from './axes.js';
import { ringMatrix } from '../spaces.js';

// COPY_LOCATION (specs/copy_location.md): copies the target's translation per axis.
export default {
  type: 'COPY_LOCATION',
  targets: 'one',
  defaults: { ...AXIS_DEFAULTS, use_offset: false },
  evaluate(owner, target, s) {
    const out = ringMatrix();
    out.set(owner);
    if (s.use_x) out[12] = (s.use_offset ? owner[12] : 0) + (s.invert_x ? -1 : 1) * target[12];
    if (s.use_y) out[13] = (s.use_offset ? owner[13] : 0) + (s.invert_y ? -1 : 1) * target[13];
    if (s.use_z) out[14] = (s.use_offset ? owner[14] : 0) + (s.invert_z ? -1 : 1) * target[14];
    return out;
  },
};
