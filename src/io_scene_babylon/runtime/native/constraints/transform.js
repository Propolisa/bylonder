// @ts-nocheck
// SPDX-License-Identifier: MIT OR Apache-2.0
// From babylon-blender-rig (scripts/native-rig.mjs).
import { split, compose, mul, eulerMatrix } from '../math.js';
import { eulerOf } from '../euler.js';
import { readTransformChannelOf } from '../drivers/channels.js';

// TRANSFORM, Transformation (specs/constraints_more.md): a target channel mapped from one range to another onto the
// owner's location, rotation or scale.
const EULER = new Set(['XYZ', 'XZY', 'YXZ', 'YZX', 'ZXY', 'ZYX']);
const AXES = ['x', 'y', 'z'];
const SUFFIX = { LOCATION: '', ROTATION: '_rot', SCALE: '_scale' };

const defaults = { map_from: 'LOCATION', map_to: 'LOCATION', from_rotation_mode: 'AUTO', to_euler_order: 'AUTO', use_motion_extrapolate: false, mix_mode: 'ADD', mix_mode_rot: 'ADD', mix_mode_scale: 'REPLACE' };
for (const a of AXES) {
  defaults[`map_to_${a}_from`] = a.toUpperCase();
  for (const sfx of ['', '_rot', '_scale']) {
    const one = sfx === '_scale' ? 1 : 0;
    Object.assign(defaults, { [`from_min_${a}${sfx}`]: one, [`from_max_${a}${sfx}`]: one, [`to_min_${a}${sfx}`]: one, [`to_max_${a}${sfx}`]: one });
  }
}

export default {
  type: 'TRANSFORM',
  targets: 'one',
  defaults,
  evaluate(owner, target, s, spaces) {
    const ownerOrder = EULER.has(spaces.rotationMode) ? spaces.rotationMode : 'XYZ';
    const T = split(target);
    let input;
    if (s.map_from === 'LOCATION') input = T.t;
    else if (s.map_from === 'SCALE') input = T.s.map(Math.abs);
    else {
      const mode = s.from_rotation_mode === 'AUTO' ? ownerOrder : s.from_rotation_mode;
      if (mode === 'QUATERNION') return null; // spec Open
      input = EULER.has(mode) ? eulerOf(T.r, mode) : [0, 1, 2].map((i) => readTransformChannelOf(T.r, `ROT_${'XYZ'[i]}`, mode));
    }
    const fs = SUFFIX[s.map_from], ts = SUFFIX[s.map_to];
    const out = AXES.map((a) => {
      const from = 'XYZ'.indexOf(s[`map_to_${a}_from`]), b = AXES[from];
      const lo = s[`from_min_${b}${fs}`], hi = s[`from_max_${b}${fs}`];
      let v = input[from];
      if (!s.use_motion_extrapolate) v = Math.min(Math.max(v, Math.min(lo, hi)), Math.max(lo, hi));
      const u = hi === lo ? 0 : (v - lo) / (hi - lo);
      return s[`to_min_${a}${ts}`] + u * (s[`to_max_${a}${ts}`] - s[`to_min_${a}${ts}`]);
    });
    const O = split(owner);
    if (s.map_to === 'LOCATION') return compose(s.mix_mode === 'REPLACE' ? out : O.t.map((v, i) => v + out[i]), O.r, O.s);
    if (s.map_to === 'SCALE') return compose(O.t, O.r, s.mix_mode_scale === 'MULTIPLY' ? O.s.map((v, i) => v * out[i]) : out);
    const order = s.to_euler_order === 'AUTO' ? ownerOrder : s.to_euler_order;
    const Rm = eulerMatrix(out, order);
    let R;
    switch (s.mix_mode_rot) {
      case 'REPLACE': R = Rm; break;
      case 'BEFORE': R = mul(Rm, O.r); break;
      case 'AFTER': R = mul(O.r, Rm); break;
      default: R = eulerMatrix(eulerOf(O.r, order).map((v, i) => v + out[i]), order);
    }
    return compose(O.t, R, O.s);
  },
};
