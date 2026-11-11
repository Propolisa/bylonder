// @ts-nocheck
// SPDX-License-Identifier: MIT OR Apache-2.0
// From babylon-blender-rig (scripts/native-rig.mjs).
// The Armature modifier on the CPU (specs/armature_modifier.md): linear blend or Preserve Volume (dual quaternions),
// vertex groups and envelopes, B-Bone segments, the modifier's mask and Multi Modifier. It is the reference the GPU
// path is checked against, and the fallback where the GPU path does not apply.
//
// bindModifier(program, object, settings) once; runModifier(inst, objectIndex, binding, src, dst) per frame.
import { mul, invert } from '../math.js';
import { mulAffine, invertAffine } from '../rig/m4.js';
import { bboneJoints, bboneContext } from './bbone.js';

// Static binding of one modifier: the deforming bones and each vertex's group weights (CSR).
export function bindModifier(program, mesh, m, geo) {
  const armIndex = program.objectIndex.get(m.object);
  if (armIndex === undefined || !program.objects[armIndex].bones) return null;
  const arm = program.objects[armIndex];
  const bones = program.bones.filter((b) => b.arm === armIndex && b.use_deform !== false);
  const { groups, count: nv } = geo;
  const start = new Int32Array(nv + 1), slot = [], weight = [];
  for (let v = 0; v < nv; v++) {
    start[v] = slot.length;
    if (m.use_vertex_groups === false) continue;
    bones.forEach((b, k) => {
      const w = groups.get(b.name)?.[v];
      if (w) { slot.push(k); weight.push(w); }
    });
  }
  start[nv] = slot.length;
  const mask = m.vertex_group ? groups.get(m.vertex_group) ?? [] : null;
  return {
    arm: armIndex, armObject: arm, bones, start, slot: Int32Array.from(slot), weight: Float64Array.from(weight), mask,
    invertMask: !!m.invert_vertex_group, useEnvelopes: !!m.use_bone_envelopes, dq: !!m.use_deform_preserve_volume,
    multi: !!m.use_multi_modifier,
  };
}

// Per bone of a modifier this frame: contributions with their deform matrix D and rest frame B (B-Bone segments
// give n + 1 contributions), plus the data each vertex needs to find its segment.
export function frameContributions(inst, mod) {
  const ctx = bboneContext(inst);
  return mod.bones.map((b) => {
    const rest = inst.restView[b.index], pose = inst.poseView[b.index];
    const restInv = invert(rest);
    const n = b.bbone_segments ?? 1;
    if (n <= 1) return { n: 1, D: [mul(pose, restInv)], B: [rest], restInv, bone: b };
    const J = bboneJoints(b, ctx, false), Jr = bboneJoints(b, ctx, true);
    const D = [], B = [], restJoints = [];
    for (let j = 0; j <= n; j++) {
      const jp = J.subarray(j * 16, j * 16 + 16), jr = Jr.slice(j * 16, j * 16 + 16);
      D.push(mul(mul(mul(pose, jp), invert(jr)), restInv));
      const Bj = mul(rest, jr);
      B.push(Bj);
      restJoints.push(Bj);
    }
    return { n, D, B, restInv, bone: b, restJoints };
  });
}

// Segment index and blend of a point for a B-Bone (armature-space p): Straight or Curved vertex mapping.
export function segmentOf(c, p) {
  const { n, restInv, bone } = c;
  if (bone.bbone_mapping_mode === 'CURVED') {
    const s = c.restJoints.map((J) => (p[0] - J[12]) * J[4] + (p[1] - J[13]) * J[5] + (p[2] - J[14]) * J[6]);
    // Joint Y axes have unit length in the rest shape (no pose scale), so s is the distance along each joint's Y.
    if (s[0] <= 0) return [0, 0];
    for (let j = 0; j < n; j++) if (s[j + 1] <= 0) return [j, s[j] / (s[j] - s[j + 1])];
    return [n - 1, 1];
  }
  const y = restInv[1] * p[0] + restInv[5] * p[1] + restInv[9] * p[2] + restInv[13];
  const x = Math.min(n, Math.max(0, (y / bone.length) * n));
  const k = Math.min(Math.floor(x), n - 1);
  return [k, x - k];
}

// Envelope of a rest bone at p (armature space).
export function envelope(b, p) {
  const h = b.head_local, t = b.tail_local;
  const ht = [t[0] - h[0], t[1] - h[1], t[2] - h[2]], l2 = ht[0] ** 2 + ht[1] ** 2 + ht[2] ** 2;
  const s = l2 ? Math.min(1, Math.max(0, ((p[0] - h[0]) * ht[0] + (p[1] - h[1]) * ht[1] + (p[2] - h[2]) * ht[2]) / l2)) : 0;
  const hr = b.head_radius ?? 0.1, tr = b.tail_radius ?? 0.1, dist = b.envelope_distance ?? 0.25;
  const r = hr + s * (tr - hr);
  const d = Math.hypot(p[0] - h[0] - s * ht[0], p[1] - h[1] - s * ht[1], p[2] - h[2] - s * ht[2]);
  if (d < r) return 1;
  if (d < r + dist) return 1 - ((d - r) / dist) ** 2;
  return 0;
}

// Dual quaternion data of one contribution (spec Preserve Volume steps 1 to 3).
export function dualQuat(D, B) {
  const P = mul(D, B);
  const y = norm([P[4], P[5], P[6]]);
  const xr = [P[0], P[1], P[2]], xd = xr[0] * y[0] + xr[1] * y[1] + xr[2] * y[2];
  const x = norm([xr[0] - xd * y[0], xr[1] - xd * y[1], xr[2] - xd * y[2]]);
  const z = [x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]];
  const Rp = new Float64Array([x[0], x[1], x[2], 0, y[0], y[1], y[2], 0, z[0], z[1], z[2], 0, 0, 0, 0, 1]);
  const RpT = new Float64Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, 0, 0, 0, 1]);
  const P3 = Float64Array.from(P); P3[12] = P3[13] = P3[14] = 0;
  const Binv = invert(B);
  const S = mul(mul(B, mul(RpT, P3)), Binv);
  const Rt = Float64Array.from(Rp); Rt[12] = P[12]; Rt[13] = P[13]; Rt[14] = P[14];
  const G = mul(Rt, Binv);
  let q = quatOf(G);
  if (q[0] < 0) q = q.map((v) => -v);
  const e = qmul([0, G[12], G[13], G[14]], q).map((v) => 0.5 * v);
  return { q, e, S };
}

const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const qmul = (a, b) => [
  a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
  a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
  a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
  a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
];

function quatOf(m) {
  const m00 = m[0], m01 = m[4], m02 = m[8], m10 = m[1], m11 = m[5], m12 = m[9], m20 = m[2], m21 = m[6], m22 = m[10];
  const tr = m00 + m11 + m22;
  let q;
  if (tr > 0) { const s = 2 * Math.sqrt(tr + 1); q = [0.25 * s, (m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s]; }
  else if (m00 > m11 && m00 > m22) { const s = 2 * Math.sqrt(1 + m00 - m11 - m22); q = [(m21 - m12) / s, 0.25 * s, (m01 + m10) / s, (m02 + m20) / s]; }
  else if (m11 > m22) { const s = 2 * Math.sqrt(1 + m11 - m00 - m22); q = [(m02 - m20) / s, (m01 + m10) / s, 0.25 * s, (m12 + m21) / s]; }
  else { const s = 2 * Math.sqrt(1 + m22 - m00 - m11); q = [(m10 - m01) / s, (m02 + m20) / s, (m12 + m21) / s, 0.25 * s]; }
  const l = Math.hypot(...q);
  return q.map((v) => v / l);
}

const transform = (M, p) => [
  M[0] * p[0] + M[4] * p[1] + M[8] * p[2] + M[12],
  M[1] * p[0] + M[5] * p[1] + M[9] * p[2] + M[13],
  M[2] * p[0] + M[6] * p[1] + M[10] * p[2] + M[14],
];

// One modifier on positions `src` (object space), into `dst`.
export function runModifier(inst, mesh, mod, src, dst) {
  const pre = new Float64Array(16), preInv = new Float64Array(16);
  mulAffine(pre, 0, inst.worldInv, mod.arm * 16, inst.world, mesh * 16);
  invertAffine(preInv, 0, pre, 0);
  const contrib = frameContributions(inst, mod);
  const dq = mod.dq ? contrib.map((c) => c.D.map((D, j) => dualQuat(D, c.B[j]))) : null;
  const nv = src.length / 3;
  for (let v = 0; v < nv; v++) {
    const p = transform(pre, [src[v * 3], src[v * 3 + 1], src[v * 3 + 2]]);
    // (bone slot, segment joint, weight) of this vertex.
    const parts = [];
    let inGroups = false;
    for (let i = mod.start[v]; i < mod.start[v + 1]; i++) if (mod.weight[i] > 0) inGroups = true;
    const add = (k, w) => {
      if (!w) return;
      const c = contrib[k];
      if (c.n <= 1) { parts.push(k, 0, w); return; }
      const [seg, f] = segmentOf(c, p);
      parts.push(k, seg, w * (1 - f), k, seg + 1, w * f);
    };
    if (mod.useEnvelopes && !inGroups) {
      contrib.forEach((c, k) => add(k, envelope(c.bone, p) * (c.bone.envelope_weight ?? 1)));
    } else {
      for (let i = mod.start[v]; i < mod.start[v + 1]; i++) {
        const c = contrib[mod.slot[i]];
        const w = mod.useEnvelopes && c.bone.use_envelope_multiply ? mod.weight[i] * envelope(c.bone, p) * (c.bone.envelope_weight ?? 1) : mod.weight[i];
        add(mod.slot[i], w);
      }
    }
    let W = 0;
    for (let i = 2; i < parts.length; i += 3) W += parts[i];
    let q = p;
    if (W > 0) q = mod.dq ? blendDQ(parts, W, dq, p) : blendLinear(parts, W, contrib, p);
    const out = transform(preInv, q);
    dst[v * 3] = out[0]; dst[v * 3 + 1] = out[1]; dst[v * 3 + 2] = out[2];
  }
}

// The modifier's mask weight of a vertex: its weight in vertex_group (inverted when set); 1 without a group.
export function maskOf(mod, v) {
  if (!mod.mask) return 1;
  const m = mod.mask[v] ?? 0;
  return mod.invertMask ? 1 - m : m;
}

function blendLinear(parts, W, contrib, p) {
  const q = [0, 0, 0];
  for (let i = 0; i < parts.length; i += 3) {
    const r = transform(contrib[parts[i]].D[parts[i + 1]], p), a = parts[i + 2] / W;
    q[0] += a * r[0]; q[1] += a * r[1]; q[2] += a * r[2];
  }
  return q;
}

function blendDQ(parts, W, dq, p) {
  let first = null;
  const Q = [0, 0, 0, 0], E = [0, 0, 0, 0], acc = [0, 0, 0, 0];
  for (let i = 0; i < parts.length; i += 3) {
    const d = dq[parts[i]][parts[i + 1]], a = parts[i + 2] / W;
    let { q, e } = d;
    if (!first) first = q;
    if (q[0] * first[0] + q[1] * first[1] + q[2] * first[2] + q[3] * first[3] < 0) { q = q.map((x) => -x); e = e.map((x) => -x); }
    const sp = transform(d.S, p);
    const qs = qmul(q, [0, sp[0], sp[1], sp[2]]);
    for (let k = 0; k < 4; k++) { Q[k] += a * q[k]; E[k] += a * e[k]; acc[k] += a * qs[k]; }
  }
  const N = Q[0] ** 2 + Q[1] ** 2 + Q[2] ** 2 + Q[3] ** 2;
  const Qc = [Q[0], -Q[1], -Q[2], -Q[3]];
  const r1 = qmul(acc, Qc), r2 = qmul(E.map((x) => 2 * x), Qc);
  return [(r1[1] + r2[1]) / N, (r1[2] + r2[2]) / N, (r1[3] + r2[3]) / N];
}
