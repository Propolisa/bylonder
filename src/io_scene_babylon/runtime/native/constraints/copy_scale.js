// @ts-nocheck
// SPDX-License-Identifier: MIT OR Apache-2.0
// From babylon-blender-rig (scripts/native-rig.mjs).
import { scaleOf, det3 } from '../math.js';
import { ringMatrix } from '../spaces.js';

// COPY_SCALE (specs/copy_scale.md): copies the target's column lengths per axis.
export default {
  type: 'COPY_SCALE',
  targets: 'one',
  defaults: { use_x: true, use_y: true, use_z: true, power: 1, use_make_uniform: false, use_offset: false, use_add: false },
  evaluate(owner, target, s) {
    const s0 = scaleOf(owner);
    let st = scaleOf(target).map((v) => Math.pow(v, s.power));
    let use = [s.use_x, s.use_y, s.use_z];
    if (s.use_make_uniform) {
      // Beyond the spec: with all axes used the volume is |det(T3)|, which differs from the product of the column
      // lengths when the target is sheared.
      const u = use.every(Boolean) ? Math.pow(Math.cbrt(Math.abs(det3(target))), s.power)
        : Math.cbrt(st.reduce((acc, v, i) => (use[i] ? acc * v : acc), 1));
      st = [u, u, u];
      if (use.some(Boolean)) use = [true, true, true];
    }
    const out = ringMatrix();
    out.set(owner);
    for (let i = 0; i < 3; i++) {
      if (!use[i]) continue;
      const v = !s.use_offset ? st[i] : s.use_add ? s0[i] + st[i] - 1 : s0[i] * st[i];
      const k = v / s0[i];
      for (let r = 0; r < 3; r++) out[i * 4 + r] *= k;
    }
    return out;
  },
};
