// @ts-nocheck
// SPDX-License-Identifier: MIT OR Apache-2.0
// From babylon-blender-rig (scripts/native-rig.mjs).
import { ringMatrix } from '../spaces.js';

const AXES = {
  TRACK_X: [0, 1], TRACK_Y: [1, 1], TRACK_Z: [2, 1],
  TRACK_NEGATIVE_X: [0, -1], TRACK_NEGATIVE_Y: [1, -1], TRACK_NEGATIVE_Z: [2, -1],
};

// DAMPED_TRACK (specs/damped_track.md): the shortest rotation pointing an owner axis at the target.
export default {
  type: 'DAMPED_TRACK',
  targets: 'one',
  defaults: { track_axis: 'TRACK_Y' },
  evaluate(owner, target, s) {
    const [i, sg] = AXES[s.track_axis] ?? AXES.TRACK_Y;
    const vx = target[12] - owner[12], vy = target[13] - owner[13], vz = target[14] - owner[14];
    if (!vx && !vy && !vz) return null;
    const la = Math.hypot(owner[i * 4], owner[i * 4 + 1], owner[i * 4 + 2]) || 1, lb = Math.hypot(vx, vy, vz);
    const ax = (owner[i * 4] / la) * sg, ay = (owner[i * 4 + 1] / la) * sg, az = (owner[i * 4 + 2] / la) * sg;
    const bx = vx / lb, by = vy / lb, bz = vz / lb, d = ax * bx + ay * by + az * bz;
    let qw, qx, qy, qz;
    if (d < -1 + 1e-12) { qw = 0; [qx, qy, qz] = oppositeAxis(i); }
    else { qw = 1 + d; qx = ay * bz - az * by; qy = az * bx - ax * bz; qz = ax * by - ay * bx; }
    const ql = Math.hypot(qw, qx, qy, qz);
    qw /= ql; qx /= ql; qy /= ql; qz /= ql;
    const r = [1 - 2 * (qy * qy + qz * qz), 2 * (qx * qy + qw * qz), 2 * (qx * qz - qw * qy),
      2 * (qx * qy - qw * qz), 1 - 2 * (qx * qx + qz * qz), 2 * (qy * qz + qw * qx),
      2 * (qx * qz + qw * qy), 2 * (qy * qz - qw * qx), 1 - 2 * (qx * qx + qy * qy)];
    const out = ringMatrix();
    for (let c = 0; c < 3; c++) {
      const x = owner[c * 4], y = owner[c * 4 + 1], z = owner[c * 4 + 2];
      for (let k = 0; k < 3; k++) out[c * 4 + k] = r[k] * x + r[3 + k] * y + r[6 + k] * z;
      out[c * 4 + 3] = 0;
    }
    out[12] = owner[12]; out[13] = owner[13]; out[14] = owner[14]; out[15] = 1;
    return out;
  },
};

// Exactly opposite: Blender turns about the owner's next axis (probed for TRACK_Y: about X).
const oppositeAxis = (i) => [[0, 0, 1], [1, 0, 0], [0, 1, 0]][i];
