// @ts-nocheck
// SPDX-License-Identifier: MIT OR Apache-2.0
// From babylon-blender-rig (scripts/native-rig.mjs).
import { mul, invert, mat, transformPoint } from '../math.js';
import { dualQuat } from '../deform/armature-modifier.js';
import { mulAffine } from '../rig/m4.js';
import { ringMatrix } from '../spaces.js';

const D = new Float64Array(16), DEF = new Float64Array(16);

// ARMATURE (specs/armature.md): the owner moves by the weighted sum of its target bones' deformations, in world
// space. Preserve Volume moves the origin as the modifier moves a vertex (constraints_more.md); the orientation
// stays the linear blend's (open in the spec). Envelopes are out of scope.
export default {
  type: 'ARMATURE',
  targets: 'multi',
  defaults: { use_deform_preserve_volume: false, use_bone_envelopes: false, use_current_location: false },
  evaluate(_owner, targets, s, spaces) {
    D.fill(0);
    let total = 0;
    for (const t of targets) {
      if (!t.bone || !t.weight) continue;
      // Inverses cached per bone rest (static) and per frame for the armature world.
      const restInv = t.bone.restInv ??= invert(t.bone.rest);
      mulAffine(DEF, 0, t.world, 0, restInv, 0);
      mulAffine(DEF, 0, DEF, 0, t.ent.armatureInv ?? invert(t.ent.armatureWorld), 0);
      for (let i = 0; i < 16; i++) D[i] += t.weight * DEF[i];
      total += t.weight;
    }
    if (!total) return null;
    for (let i = 0; i < 16; i++) D[i] /= total;
    const out = ringMatrix();
    mulAffine(out, 0, D, 0, spaces.w0, 0);
    if (s.use_deform_preserve_volume) {
      const p = preserveVolumeOrigin(targets.filter((t) => t.bone && t.weight), total, [spaces.w0[12], spaces.w0[13], spaces.w0[14]]);
      out[12] = p[0]; out[13] = p[1]; out[14] = p[2];
    }
    return spaces.toOwner(out);
  },
};

const qmul = (a, b) => [
  a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3], a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
  a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1], a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
];

// The dual quaternion blend of the modifier (armature_modifier.md) on one world point, in the first target's armature
// space.
function preserveVolumeOrigin(targets, total, world) {
  const A = targets[0].ent.armatureWorld, Ai = invert(A), p = transformPoint(Ai, world);
  const Q = [0, 0, 0, 0], E = [0, 0, 0, 0], acc = [0, 0, 0, 0];
  let first = null;
  for (const t of targets) {
    const D = mul(mul(Ai, mul(t.world, invert(t.bone.rest))), mul(invert(t.ent.armatureWorld), A));
    let { q, e, S } = dualQuat(D, t.bone.rest);
    first ??= q;
    if (q[0] * first[0] + q[1] * first[1] + q[2] * first[2] + q[3] * first[3] < 0) { q = q.map((x) => -x); e = e.map((x) => -x); }
    const a = t.weight / total, sp = transformPoint(S, p), qs = qmul(q, [0, ...sp]);
    for (let k = 0; k < 4; k++) { Q[k] += a * q[k]; E[k] += a * e[k]; acc[k] += a * qs[k]; }
  }
  const N = Q[0] ** 2 + Q[1] ** 2 + Q[2] ** 2 + Q[3] ** 2, Qc = [Q[0], -Q[1], -Q[2], -Q[3]];
  const r1 = qmul(acc, Qc), r2 = qmul(E.map((x) => 2 * x), Qc);
  return transformPoint(A, [(r1[1] + r2[1]) / N, (r1[2] + r2[2]) / N, (r1[3] + r2[3]) / N]);
}
