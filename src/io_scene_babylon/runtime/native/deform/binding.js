// @ts-nocheck
// SPDX-License-Identifier: MIT OR Apache-2.0
// From babylon-blender-rig (scripts/native-rig.mjs).
// The Armature modifier as linear blend skinning over a flat joint list, for the GPU (Babylon's bone texture).
// Each deforming bone is one joint, each B-Bone n + 1 joints (its segment joints); a vertex's B-Bone segment and blend
// (Straight or Curved mapping), envelopes, the modifier's mask and Multi Modifier mixing are folded into per-vertex
// joint weights once, from the rest positions. The last joint (index joints.length) is the identity.
//
// Not expressible as one linear blend: Preserve Volume, and modifiers stacked without Multi Modifier; for those
// binding.supported is false with a reason, and deformMesh (armature-modifier.js) is the path.
import { mulAffine, invertAffine } from '../rig/m4.js';
import { frameContributions, segmentOf, envelope, dualQuat } from './armature-modifier.js';
import { applyShapeKeys } from './shape-keys.js';

export const MAX_INFLUENCES = 8;

export function buildBinding(inst, deform) {
  const reasons = [];
  const dq = deform.modifiers.some((m) => m.dq);
  const others = [...new Set(deform.steps.filter((m) => m.type !== 'ARMATURE').map((m) => m.type))];
  if (others.length) reasons.push(`${others.join(', ')} in the stack`);
  if (dq && deform.modifiers.length > 1) reasons.push('Preserve Volume with several modifiers');
  if (deform.modifiers.some((m, k) => k > 0 && !m.multi)) reasons.push('modifiers stacked without Multi Modifier');
  const base = deform.shapeKeys ? applyShapeKeys(inst, deform) : deform.base;
  const nv = base.length / 3;
  const joints = []; // { mod, slot, seg }
  const jointIndex = new Map();
  const jointOf = (mod, slot, seg) => {
    const key = `${mod}/${slot}/${seg}`;
    if (!jointIndex.has(key)) { jointIndex.set(key, joints.length); joints.push({ mod, slot, seg }); }
    return jointIndex.get(key);
  };
  let cur = Array.from({ length: nv }, () => new Map([[-1, 1]])); // -1: identity
  deform.modifiers.forEach((mod, k) => {
    const contrib = frameContributions(inst, mod);
    const pre = preMatrix(inst, deform.mesh, mod.arm);
    const own = [];
    for (let v = 0; v < nv; v++) {
      const p = transform(pre, base, v * 3);
      const parts = new Map();
      let inGroups = false;
      for (let i = mod.start[v]; i < mod.start[v + 1]; i++) if (mod.weight[i] > 0) inGroups = true;
      const add = (slot, w) => {
        if (!w) return;
        const c = contrib[slot];
        if (c.n <= 1) { addTo(parts, jointOf(k, slot, 0), w); return; }
        const [seg, f] = segmentOf(c, p);
        addTo(parts, jointOf(k, slot, seg), w * (1 - f));
        addTo(parts, jointOf(k, slot, seg + 1), w * f);
      };
      if (mod.useEnvelopes && !inGroups) contrib.forEach((c, slot) => add(slot, envelope(c.bone, p) * (c.bone.envelope_weight ?? 1)));
      else {
        for (let i = mod.start[v]; i < mod.start[v + 1]; i++) {
          const c = contrib[mod.slot[i]];
          add(mod.slot[i], mod.useEnvelopes && c.bone.use_envelope_multiply ? mod.weight[i] * envelope(c.bone, p) * (c.bone.envelope_weight ?? 1) : mod.weight[i]);
        }
      }
      let W = 0;
      for (const w of parts.values()) W += w;
      const deformed = new Map();
      if (W > 0) for (const [j, w] of parts) deformed.set(j, w / W);
      else if (!dq) deformed.set(-1, 1);
      own.push(deformed);
    }
    const masked = (v) => (mod.mask ? (mod.invertMask ? 1 - (mod.mask[v] ?? 0) : mod.mask[v] ?? 0) : 1);
    cur = cur.map((prev, v) => {
      const m = masked(v), out = new Map();
      // First modifier: in + m (deformed - in). Multi Modifier: previous result (1 - m) + own m. Dual quaternions
      // keep only the bone weights (summing to m); the shader mixes with the input by their sum.
      const keep = dq ? new Map() : k === 0 || !mod.multi ? new Map([[-1, 1]]) : prev;
      for (const [j, w] of keep) addTo(out, j, w * (1 - m));
      for (const [j, w] of own[v]) addTo(out, j, w * m);
      return out;
    });
  });
  // Joints in bone order (mod, bone slot, segment): the dual quaternion flip reference is the first bone.
  const order = joints.map((j, i) => i).sort((a, b) => joints[a].mod - joints[b].mod || joints[a].slot - joints[b].slot || joints[a].seg - joints[b].seg);
  const renumber = new Map(order.map((old, i) => [old, i]));
  joints.splice(0, joints.length, ...order.map((i) => joints[i]));
  cur = cur.map((m) => new Map([...m].map(([j, w]) => [j < 0 ? j : renumber.get(j), w])));
  // Pack: up to MAX_INFLUENCES largest weights per vertex, renormalized (to their sum for dual quaternions), stored
  // by ascending joint.
  const identity = joints.length;
  const indices = new Float32Array(nv * MAX_INFLUENCES), weights = new Float32Array(nv * MAX_INFLUENCES);
  let used = 1, overflow = 0;
  cur.forEach((m, v) => {
    const list = [...m].filter(([, w]) => w > 0).sort((a, b) => b[1] - a[1]);
    if (list.length > MAX_INFLUENCES) overflow++;
    const kept = list.slice(0, MAX_INFLUENCES).sort((a, b) => a[0] - b[0]);
    const total = list.reduce((a, [, w]) => a + w, 0), sum = kept.reduce((a, [, w]) => a + w, 0) || 1;
    const scale = dq ? total / sum : 1 / sum;
    used = Math.max(used, kept.length);
    kept.forEach(([j, w], i) => { indices[v * MAX_INFLUENCES + i] = j < 0 ? identity : j; weights[v * MAX_INFLUENCES + i] = w * scale; });
  });
  return { joints, indices, weights, influences: used <= 4 ? 4 : 8, overflow, dq, supported: !reasons.length, reasons };
}

const addTo = (m, k, w) => m.set(k, (m.get(k) ?? 0) + w);

function preMatrix(inst, mesh, arm) {
  const pre = new Float64Array(16);
  mulAffine(pre, 0, inst.worldInv, arm * 16, inst.world, mesh * 16);
  return pre;
}

const transform = (M, a, o) => [
  M[0] * a[o] + M[4] * a[o + 1] + M[8] * a[o + 2] + M[12],
  M[1] * a[o] + M[5] * a[o + 1] + M[9] * a[o + 2] + M[13],
  M[2] * a[o] + M[6] * a[o + 1] + M[10] * a[o + 2] + M[14],
];

// Joint matrices in the mesh's object space, M = pre^-1 @ D @ pre, written as 16 floats per joint into out
// (column-major, which is also Babylon's Matrix layout), followed by the identity.
export function jointMatrices(inst, deform, binding, out = new Float32Array((binding.joints.length + 1) * 16)) {
  const perMod = deform.modifiers.map((mod) => {
    const pre = preMatrix(inst, deform.mesh, mod.arm), preInv = new Float64Array(16);
    invertAffine(preInv, 0, pre, 0);
    return { pre, preInv, contrib: frameContributions(inst, mod) };
  });
  const M = new Float64Array(16);
  binding.joints.forEach((jt, i) => {
    const { pre, preInv, contrib } = perMod[jt.mod];
    mulAffine(M, 0, contrib[jt.slot].D[jt.seg], 0, pre, 0);
    mulAffine(M, 0, preInv, 0, M, 0);
    for (let k = 0; k < 16; k++) out[i * 16 + k] = M[k];
  });
  const id = binding.joints.length * 16;
  out.fill(0, id, id + 16);
  out[id] = out[id + 5] = out[id + 10] = out[id + 15] = 1;
  return out;
}

// Dual quaternion data per joint for the GPU (24 floats: q as x, y, z, w; e likewise; the scale matrix S, column-major)
// and the modifier's pre matrices (armature from mesh space and back).
export function dualQuatData(inst, deform, binding, out = new Float32Array(binding.joints.length * 24)) {
  const mod = deform.modifiers[0], contrib = frameContributions(inst, mod);
  const pre = preMatrix(inst, deform.mesh, mod.arm), preInv = new Float64Array(16);
  invertAffine(preInv, 0, pre, 0);
  binding.joints.forEach((jt, i) => {
    const c = contrib[jt.slot], { q, e, S } = dualQuat(c.D[jt.seg], c.B[jt.seg]), o = i * 24;
    out[o] = q[1]; out[o + 1] = q[2]; out[o + 2] = q[3]; out[o + 3] = q[0];
    out[o + 4] = e[1]; out[o + 5] = e[2]; out[o + 6] = e[3]; out[o + 7] = e[0];
    for (let k = 0; k < 16; k++) out[o + 8 + k] = S[k];
  });
  return { data: out, pre, preInv };
}

// The dual quaternion blend the shader computes, on the CPU: positions in object space.
export function skinDQ(base, binding, { data, pre, preInv }) {
  const nv = base.length / 3, out = new Float64Array(base.length);
  const qm = (a, b) => [ // (x, y, z, w) quaternions
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
  for (let v = 0; v < nv; v++) {
    const p = transform(pre, base, v * 3);
    let m = 0, first = null;
    const Q = [0, 0, 0, 0], E = [0, 0, 0, 0], acc = [0, 0, 0, 0];
    for (let i = 0; i < MAX_INFLUENCES; i++) {
      const w = binding.weights[v * MAX_INFLUENCES + i];
      if (!w) continue;
      const o = binding.indices[v * MAX_INFLUENCES + i] * 24;
      let q = Array.from(data.subarray(o, o + 4)), e = Array.from(data.subarray(o + 4, o + 8));
      first ??= q;
      if (q[0] * first[0] + q[1] * first[1] + q[2] * first[2] + q[3] * first[3] < 0) { q = q.map((x) => -x); e = e.map((x) => -x); }
      const sp = transform(data.subarray(o + 8, o + 24), p, 0);
      const qs = qm(q, [sp[0], sp[1], sp[2], 0]);
      for (let k = 0; k < 4; k++) { Q[k] += w * q[k]; E[k] += w * e[k]; acc[k] += w * qs[k]; }
      m += w;
    }
    if (!m) { for (let a = 0; a < 3; a++) out[v * 3 + a] = base[v * 3 + a]; continue; }
    // Weights sum to m (the mask): the normalized blend divides it out.
    const N = (Q[0] ** 2 + Q[1] ** 2 + Q[2] ** 2 + Q[3] ** 2) / m;
    const Qc = [-Q[0], -Q[1], -Q[2], Q[3]];
    const r1 = qm(acc, Qc), r2 = qm(E.map((x) => 2 * x), Qc);
    const d = [(r1[0] + r2[0]) / N / m, (r1[1] + r2[1]) / N / m, (r1[2] + r2[2]) / N / m];
    const back = transform(preInv, d, 0);
    for (let a = 0; a < 3; a++) out[v * 3 + a] = base[v * 3 + a] + m * (back[a] - base[v * 3 + a]);
  }
  return out;
}

// The linear blend the GPU computes, on the CPU (tests and the fallback check): positions in object space.
export function skin(base, binding, matrices) {
  const nv = base.length / 3, out = new Float64Array(base.length);
  for (let v = 0; v < nv; v++) {
    for (let i = 0; i < MAX_INFLUENCES; i++) {
      const w = binding.weights[v * MAX_INFLUENCES + i];
      if (!w) continue;
      const o = binding.indices[v * MAX_INFLUENCES + i] * 16;
      for (let r = 0; r < 3; r++) out[v * 3 + r] += w * (matrices[o + r] * base[v * 3] + matrices[o + 4 + r] * base[v * 3 + 1] + matrices[o + 8 + r] * base[v * 3 + 2] + matrices[o + 12 + r]);
    }
  }
  return out;
}

