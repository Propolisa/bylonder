// @ts-nocheck
// SPDX-License-Identifier: MIT OR Apache-2.0
// From babylon-blender-rig (scripts/native-rig.mjs).
// Each armature's deform joints, computed once per instance and evaluate() and shared by every mesh and path (CPU
// stack, skeleton textures, dual quaternion data, compute): per deform bone its joints (a B-Bone n + 1 segment
// joints), D (armature space, 16 per joint, D_j = Pose @ J_j @ Jr_j^-1 @ Rest^-1), the rest frames B (B_j = Rest @
// Jr_j), and on demand the dual quaternion data (q, e as w x y z, then S: 24 per joint). Only bones some binding uses
// (useBones) are computed.
import { mulAffine, invertAffine } from '../rig/m4.js';
import { bboneJoints, bboneContext } from './bbone.js';

// Marks bones (indices) as used; a bone new this frame is computed at the next update.
export function useBones(J, bones) {
  for (const b of bones) if (!J.needed[b]) { J.needed[b] = 1; J.pass = J.dqPass = -1; }
}

export function armatureJoints(inst, arm) {
  const cache = (inst.cpuJoints ??= new Map());
  let J = cache.get(arm);
  if (!J) {
    const P = inst.program, offset = new Int32Array(P.bones.length).fill(-1), bones = [];
    let count = 0;
    for (const b of P.bones) {
      if (b.arm !== arm || b.use_deform === false) continue;
      offset[b.index] = count; bones.push(b);
      count += (b.bbone_segments ?? 1) > 1 ? b.bbone_segments + 1 : 1;
    }
    const segments = new Int32Array(P.bones.length), curved = new Uint8Array(P.bones.length), length = new Float64Array(P.bones.length);
    const restInv = new Float64Array(P.bones.length * 16);
    for (const b of bones) {
      segments[b.index] = b.bbone_segments ?? 1; curved[b.index] = b.bbone_mapping_mode === 'CURVED' ? 1 : 0; length[b.index] = b.length;
      invertAffine(restInv, b.index * 16, inst.restView[b.index], 0);
    }
    J = { offset, bones, count, segments, curved, length, restInv, needed: new Uint8Array(P.bones.length), D: new Float64Array(count * 16), B: new Float64Array(count * 16),
      dq: new Float64Array(count * 24), restDone: new Uint8Array(P.bones.length), pass: -1, dqPass: -1 };
    cache.set(arm, J);
  }
  return J;
}

export function updateJoints(inst, J) {
  if (J.pass === inst.pass) return;
  J.pass = inst.pass;
  const ctx = bboneContext(inst), T = TMP, restInv = TMP2;
  // Rest shapes once, and again each frame for bones whose edit B-Bone values are driven.
  const drivenEdit = inst.boneData?.size ? new Set(Array.from(inst.boneData.keys(), (k) => +k.slice(0, k.indexOf('/')))) : null;
  for (const b of J.bones) {
    if (!J.needed[b.index]) continue;
    const o = J.offset[b.index], n = b.bbone_segments ?? 1, pose = inst.poseView[b.index], rest = inst.restView[b.index];
    invertAffine(restInv, 0, rest, 0);
    const restStale = !J.restDone[b.index] || drivenEdit?.has(b.index);
    J.restDone[b.index] = 1;
    if (n <= 1) {
      mulAffine(J.D, o * 16, pose, 0, restInv, 0);
      if (restStale) J.B.set(rest, o * 16);
      continue;
    }
    // D_j = Pose @ J_j @ Jr_j^-1 @ Rest^-1; B_j = Rest @ Jr_j (armature_modifier.md, B-Bones).
    const Jp = bboneJoints(b, ctx, false);
    if (restStale) {
      const Jr = bboneJoints(b, ctx, true);
      for (let j = 0; j <= n; j++) mulAffine(J.B, (o + j) * 16, rest, 0, Jr, j * 16);
    }
    for (let j = 0; j <= n; j++) {
      const k = (o + j) * 16;
      invertAffine(T, 0, J.B, k); // (Rest @ Jr_j)^-1 = Jr_j^-1 @ Rest^-1
      mulAffine(T, 0, Jp, j * 16, T, 0);
      mulAffine(J.D, k, pose, 0, T, 0);
    }
  }
}

export function updateDualQuats(inst, J) {
  updateJoints(inst, J);
  if (J.dqPass === inst.pass) return;
  J.dqPass = inst.pass;
  for (const b of J.bones) {
    if (!J.needed[b.index]) continue;
    const o = J.offset[b.index], n = J.segments[b.index] > 1 ? J.segments[b.index] + 1 : 1;
    for (let j = o; j < o + n; j++) dualQuatInto(J.dq, j * 24, J.D, j * 16, J.B, j * 16);
  }
}

// armature-modifier.js dualQuat without allocation: q, e (w x y z) and S of deform D with rest frame B.
function dualQuatInto(out, oo, D, Do, B, Bo) {
  const P = DQ_P, R = DQ_R, Bi = DQ_BI;
  mulAffine(P, 0, D, Do, B, Bo);
  let l = Math.hypot(P[4], P[5], P[6]) || 1;
  const yx = P[4] / l, yy = P[5] / l, yz = P[6] / l, xd = P[0] * yx + P[1] * yy + P[2] * yz;
  let xx = P[0] - xd * yx, xy = P[1] - xd * yy, xz = P[2] - xd * yz;
  l = Math.hypot(xx, xy, xz) || 1; xx /= l; xy /= l; xz /= l;
  const zx = xy * yz - xz * yy, zy = xz * yx - xx * yz, zz = xx * yy - xy * yx;
  invertAffine(Bi, 0, B, Bo);
  // S = B @ Rp^T @ P3 @ B^-1 (P3: P without translation).
  R.fill(0); R[15] = 1;
  R[0] = xx; R[4] = xy; R[8] = xz; R[1] = yx; R[5] = yy; R[9] = yz; R[2] = zx; R[6] = zy; R[10] = zz;
  const tx = P[12], ty = P[13], tz = P[14];
  P[12] = P[13] = P[14] = 0;
  mulAffine(R, 0, R, 0, P, 0);
  mulAffine(R, 0, B, Bo, R, 0);
  mulAffine(R, 0, R, 0, Bi, 0);
  for (let k = 0; k < 16; k++) out[oo + 8 + k] = R[k];
  // G = Rt @ B^-1 (Rt: Rp with P's translation).
  R.fill(0); R[15] = 1;
  R[0] = xx; R[1] = xy; R[2] = xz; R[4] = yx; R[5] = yy; R[6] = yz; R[8] = zx; R[9] = zy; R[10] = zz; R[12] = tx; R[13] = ty; R[14] = tz;
  mulAffine(R, 0, R, 0, Bi, 0);
  quatInto(out, oo, R);
  if (out[oo] < 0) for (let k = 0; k < 4; k++) out[oo + k] = -out[oo + k];
  // e = 0.5 (0, t) q
  const gx = R[12], gy = R[13], gz = R[14], qw = out[oo], qx = out[oo + 1], qy = out[oo + 2], qz = out[oo + 3];
  out[oo + 4] = 0.5 * (-gx * qx - gy * qy - gz * qz);
  out[oo + 5] = 0.5 * (gx * qw + gy * qz - gz * qy);
  out[oo + 6] = 0.5 * (-gx * qz + gy * qw + gz * qx);
  out[oo + 7] = 0.5 * (gx * qy - gy * qx + gz * qw);
}

// Unit quaternion (w x y z) of a rotation matrix's 3x3 (armature-modifier.js quatOf).
function quatInto(out, o, m) {
  const m00 = m[0], m01 = m[4], m02 = m[8], m10 = m[1], m11 = m[5], m12 = m[9], m20 = m[2], m21 = m[6], m22 = m[10];
  const tr = m00 + m11 + m22;
  let w, x, y, z;
  if (tr > 0) { const s = 2 * Math.sqrt(tr + 1); w = 0.25 * s; x = (m21 - m12) / s; y = (m02 - m20) / s; z = (m10 - m01) / s; }
  else if (m00 > m11 && m00 > m22) { const s = 2 * Math.sqrt(1 + m00 - m11 - m22); w = (m21 - m12) / s; x = 0.25 * s; y = (m01 + m10) / s; z = (m02 + m20) / s; }
  else if (m11 > m22) { const s = 2 * Math.sqrt(1 + m11 - m00 - m22); w = (m02 - m20) / s; x = (m01 + m10) / s; y = 0.25 * s; z = (m12 + m21) / s; }
  else { const s = 2 * Math.sqrt(1 + m22 - m00 - m11); w = (m10 - m01) / s; x = (m02 + m20) / s; y = (m12 + m21) / s; z = 0.25 * s; }
  const l = Math.hypot(w, x, y, z);
  out[o] = w / l; out[o + 1] = x / l; out[o + 2] = y / l; out[o + 3] = z / l;
}

const DQ_P = new Float64Array(16), DQ_R = new Float64Array(16), DQ_BI = new Float64Array(16);
const TMP = new Float64Array(16), TMP2 = new Float64Array(16);
