// @ts-nocheck
// SPDX-License-Identifier: MIT OR Apache-2.0
// From babylon-blender-rig (scripts/native-rig.mjs).
import { fixShear as fixShear3 } from '../rig/inherit.js';
import { ringMatrix } from '../spaces.js';
import { fixShear, scaleOf, normalizedCols, col, translation, sub, len, scaleV, normalize, cross, fromCols, quatFromTo, matrixFromQuat, transformDir } from '../math.js';

// STRETCH_TO (specs/stretch_to.md): aim the owner's Y axis at the target, scale Y to reach it, keep volume.
export function bulgeLimit(f, s) {
  if (s.use_bulge_max && f > 1) {
    const m = s.bulge_max, hard = Math.min(f, m);
    const sm = m === 1 ? hard : 1 + (m - 1) * (2 / Math.PI) * Math.atan((f - 1) / (m - 1));
    return (1 - s.bulge_smooth) * hard + s.bulge_smooth * sm;
  }
  if (s.use_bulge_min && f < 1) {
    const n = s.bulge_min, hard = Math.max(f, n);
    const sm = n === 1 ? hard : 1 - (1 - n) * (2 / Math.PI) * Math.atan((1 - f) / (1 - n));
    return (1 - s.bulge_smooth) * hard + s.bulge_smooth * sm;
  }
  return f;
}

const M9 = new Float64Array(9), F9 = new Float64Array(9);

// SWING_Y (the default) in place: fix_shear of the owner, the shortest turn of its Y onto the target, scales kept but Y.
function swingY(owner, target, s, spaces) {
  for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) M9[c * 3 + r] = owner[c * 4 + r];
  fixShear3(F9, M9);
  const hx = owner[12], hy = owner[13], hz = owner[14];
  const vx = target[12] - hx, vy = target[13] - hy, vz = target[14] - hz, d = Math.sqrt(vx * vx + vy * vy + vz * vz);
  if (!d) return null;
  const l0 = Math.hypot(F9[0], F9[1], F9[2]), l1 = Math.hypot(F9[3], F9[4], F9[5]), l2 = Math.hypot(F9[6], F9[7], F9[8]);
  let rest = s.rest_length;
  if (!rest) { rest = d / l1; spaces.store('rest_length', rest); }
  const sy = d / rest, f = bulgeLimit(Math.pow(sy / l1, -s.bulge), s);
  let sx = l0, sz = l2;
  if (s.volume === 'VOLUME_XZX' || !s.volume) { sx *= Math.sqrt(f); sz *= Math.sqrt(f); }
  else if (s.volume === 'VOLUME_X') sx *= f;
  else if (s.volume === 'VOLUME_Z') sz *= f;
  const yx = vx / d, yy = vy / d, yz = vz / d, ax = F9[3] / l1, ay = F9[4] / l1, az = F9[5] / l1;
  // quatFromTo(a, y), then its matrix applied to the owner's normalized X and Z.
  let qw, qx, qy, qz;
  const dt = ax * yx + ay * yy + az * yz;
  if (dt < -1 + 1e-12) {
    let cx, cy, cz;
    if (Math.abs(ax) < 0.9) { cx = 0; cy = az; cz = -ay; } else { cx = -az; cy = 0; cz = ax; }
    const cl = Math.hypot(cx, cy, cz);
    qw = 0; qx = cx / cl; qy = cy / cl; qz = cz / cl;
  } else { qw = 1 + dt; qx = ay * yz - az * yy; qy = az * yx - ax * yz; qz = ax * yy - ay * yx; }
  const ql = Math.hypot(qw, qx, qy, qz);
  qw /= ql; qx /= ql; qy /= ql; qz /= ql;
  const r00 = 1 - 2 * (qy * qy + qz * qz), r01 = 2 * (qx * qy - qw * qz), r02 = 2 * (qx * qz + qw * qy);
  const r10 = 2 * (qx * qy + qw * qz), r11 = 1 - 2 * (qx * qx + qz * qz), r12 = 2 * (qy * qz - qw * qx);
  const r20 = 2 * (qx * qz - qw * qy), r21 = 2 * (qy * qz + qw * qx), r22 = 1 - 2 * (qx * qx + qy * qy);
  const out = ringMatrix();
  const put = (c, x, y, z, k) => {
    out[c * 4] = (r00 * x + r01 * y + r02 * z) * k; out[c * 4 + 1] = (r10 * x + r11 * y + r12 * z) * k; out[c * 4 + 2] = (r20 * x + r21 * y + r22 * z) * k; out[c * 4 + 3] = 0;
  };
  put(0, F9[0] / l0, F9[1] / l0, F9[2] / l0, sx);
  out[4] = yx * sy; out[5] = yy * sy; out[6] = yz * sy; out[7] = 0;
  put(2, F9[6] / l2, F9[7] / l2, F9[8] / l2, sz);
  out[12] = hx; out[13] = hy; out[14] = hz; out[15] = 1;
  return out;
}

export default {
  type: 'STRETCH_TO',
  targets: 'one',
  defaults: {
    rest_length: 0, bulge: 1, use_bulge_min: false, bulge_min: 1, use_bulge_max: false, bulge_max: 1, bulge_smooth: 0,
    volume: 'VOLUME_XZX', keep_axis: 'SWING_Y',
  },
  evaluate(owner, target, s, spaces) {
    if (s.keep_axis === 'SWING_Y' || !s.keep_axis) return swingY(owner, target, s, spaces);
    const o3 = owner;
    const h = translation(owner), s0 = scaleOf(o3), r0 = normalizedCols(o3);
    const v = sub(translation(target), h), d = len(v);
    if (!d) return null;
    let rest = s.rest_length;
    if (!rest) { rest = d / s0[1]; spaces.store('rest_length', rest); }
    const sy = d / rest, q = sy / s0[1];
    const f = bulgeLimit(Math.pow(q, -s.bulge), s);
    let sx = s0[0], sz = s0[2];
    if (s.volume === 'VOLUME_XZX') { sx *= Math.sqrt(f); sz *= Math.sqrt(f); }
    else if (s.volume === 'VOLUME_X') sx *= f;
    else if (s.volume === 'VOLUME_Z') sz *= f;
    const y = scaleV(v, 1 / d);
    let x, z;
    if (s.keep_axis === 'PLANE_X') { z = normalize(cross(col(r0, 0), y)); x = cross(y, z); }
    else if (s.keep_axis === 'PLANE_Z') { x = normalize(cross(y, col(r0, 2))); z = cross(x, y); }
    else {
      const swing = matrixFromQuat(quatFromTo(col(r0, 1), y));
      x = transformDir(swing, col(r0, 0)); z = transformDir(swing, col(r0, 2));
    }
    return fromCols(scaleV(x, sx), scaleV(y, sy), scaleV(z, sz), h);
  },
};
