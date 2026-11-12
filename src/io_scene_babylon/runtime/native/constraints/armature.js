// @ts-nocheck
// SPDX-License-Identifier: MIT OR Apache-2.0
// From babylon-blender-rig (scripts/native-rig.mjs).
import { mul, invert, transformPoint } from '../math.js';
import { dualQuat } from '../deform/armature-modifier.js';
import { mulAffine } from '../rig/m4.js';
import { ringMatrix } from '../spaces.js';

const D = new Float64Array(16), DEF = new Float64Array(16);

// ARMATURE (specs/armature.md, constraints_more.md "Preserve Volume and B-Bone targets"): each target contributes as a
// vertex weight of the Armature modifier at the owner's origin; a B-Bone target gives its two segment joints around it
// (Straight mapping). Linear: the weighted sum of the deformations. Preserve Volume: the origin by the modifier's point
// map, the 3x3 by the blended rotation times the blended scale matrix. Envelopes are out of scope.
export default {
  type: 'ARMATURE',
  targets: 'multi',
  defaults: { use_deform_preserve_volume: false, use_bone_envelopes: false, use_current_location: false },
  evaluate(_owner, targets, s, spaces) {
    const origin = [spaces.w0[12], spaces.w0[13], spaces.w0[14]];
    const parts = contributions(targets, origin);
    if (!parts) return null;
    const out = ringMatrix();
    if (s.use_deform_preserve_volume) {
      const { p, M3 } = preserveVolume(parts, origin);
      const o = mul(M3, spaces.w0);
      for (let i = 0; i < 12; i++) out[i] = o[i];
      out[12] = p[0]; out[13] = p[1]; out[14] = p[2]; out[15] = 1;
      return spaces.toOwner(out);
    }
    D.fill(0);
    for (const c of parts) {
      // World deformation A @ D @ A^-1.
      mulAffine(DEF, 0, c.A, 0, c.D, 0);
      mulAffine(DEF, 0, DEF, 0, c.Ai, 0);
      for (let i = 0; i < 16; i++) D[i] += c.w * DEF[i];
    }
    mulAffine(out, 0, D, 0, spaces.w0, 0);
    return spaces.toOwner(out);
  },
};

// Per target bone (and B-Bone segment): normalized weight w, deformation D and rest frame B in its armature space,
// the armature world A and its inverse.
function contributions(targets, origin) {
  let total = 0;
  for (const t of targets) if (t.bone && t.weight) total += t.weight;
  if (!total) return null;
  const parts = [];
  for (const t of targets) {
    if (!t.bone || !t.weight) continue;
    const A = t.ent.armatureWorld, Ai = t.ent.armatureInv ?? invert(A), rest = t.bone.rest, w = t.weight / total;
    const restInv = t.bone.restInv ??= invert(rest);
    const pose = mul(Ai, t.world);
    if (!t.bone.segments) { parts.push({ w, D: mul(pose, restInv), B: rest, A, Ai }); continue; }
    const Jp = t.bone.segments(false), Jr = t.bone.segments(true), n = t.bone.bone.bbone_segments;
    const B = (j) => mul(rest, Jr.subarray(j * 16, j * 16 + 16));
    const Dj = (j) => mul(mul(pose, Jp.subarray(j * 16, j * 16 + 16)), invert(B(j)));
    // Straight mapping: the origin's rest Y along the bone, scaled to 0..n.
    const y = transformPoint(restInv, transformPoint(Ai, origin))[1], x = Math.min(n, Math.max(0, (y / t.bone.bone.length) * n));
    const k = Math.min(Math.floor(x), n - 1), f = x - k;
    if (1 - f) parts.push({ w: w * (1 - f), D: Dj(k), B: B(k), A, Ai });
    if (f) parts.push({ w: w * f, D: Dj(k + 1), B: B(k + 1), A, Ai });
  }
  return parts;
}

const qmul = (a, b) => [
  a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3], a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
  a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1], a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
];

// Preserve Volume in the first target's armature space: the origin moved as the modifier moves a vertex, and the 3x3
// rot(Q / |Q|) @ Ss3 (Ss the blended scale matrices), returned in world space as M3 (no translation).
function preserveVolume(parts, world) {
  const A = parts[0].A, Ai = parts[0].Ai, p = transformPoint(Ai, world);
  const Q = [0, 0, 0, 0], E = [0, 0, 0, 0], acc = [0, 0, 0, 0], Ss = new Float64Array(16);
  let first = null;
  for (const c of parts) {
    // The contribution's deformation in the first target's armature space.
    const D = c.A === A ? c.D : mul(mul(Ai, mul(c.A, c.D)), mul(c.Ai, A));
    let { q, e, S } = dualQuat(D, c.B);
    first ??= q;
    if (q[0] * first[0] + q[1] * first[1] + q[2] * first[2] + q[3] * first[3] < 0) { q = q.map((x) => -x); e = e.map((x) => -x); }
    const sp = transformPoint(S, p), qs = qmul(q, [0, ...sp]);
    for (let k = 0; k < 4; k++) { Q[k] += c.w * q[k]; E[k] += c.w * e[k]; acc[k] += c.w * qs[k]; }
    for (let i = 0; i < 16; i++) Ss[i] += c.w * S[i];
  }
  const N = Q[0] ** 2 + Q[1] ** 2 + Q[2] ** 2 + Q[3] ** 2, Qc = [Q[0], -Q[1], -Q[2], -Q[3]];
  const r1 = qmul(acc, Qc), r2 = qmul(E.map((x) => 2 * x), Qc);
  const origin = transformPoint(A, [(r1[1] + r2[1]) / N, (r1[2] + r2[2]) / N, (r1[3] + r2[3]) / N]);
  const l = Math.sqrt(N), [w, x, y, z] = Q.map((v) => v / l);
  const R = new Float64Array([1 - 2 * (y * y + z * z), 2 * (x * y + w * z), 2 * (x * z - w * y), 0, 2 * (x * y - w * z), 1 - 2 * (x * x + z * z), 2 * (y * z + w * x), 0,
    2 * (x * z + w * y), 2 * (y * z - w * x), 1 - 2 * (x * x + y * y), 0, 0, 0, 0, 1]);
  Ss[12] = Ss[13] = Ss[14] = 0; Ss[15] = 1;
  const M3 = mul(mul(A, mul(R, Ss)), Ai);
  M3[12] = M3[13] = M3[14] = 0;
  return { p: origin, M3 };
}
