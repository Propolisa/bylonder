// @ts-nocheck
// SPDX-License-Identifier: MIT OR Apache-2.0
// From babylon-blender-rig (scripts/native-rig.mjs).
// The modifier stack compiled for the CPU: the passes of deformMesh (mesh.js, the reference) over preallocated typed
// arrays, with static data (influences, stencils, neighbours, corner offsets, face corners) built once. Per frame the
// armature's joint matrices are computed once per instance and shared by every mesh; the vertex loops allocate
// nothing. Steps without a pass here (Shrinkwrap, Displace, Multi Modifier after the first Armature) run through
// mesh.js. A Surface Deform target is evaluated once per evaluate() (targets.js).
//
//   const cpu = new CpuStack(inst, deform, { axis });  // once
//   cpu.run();  // after inst.evaluate(): cpu.positions and cpu.normals (Float32Array xyz per drawn vertex)
import { mulAffine, invertAffine } from '../rig/m4.js';
import { armatureJoints, useBones, updateJoints, updateDualQuats } from './joints.js';
import { maskOf } from './armature-modifier.js';
import { relativeTerms, keyValue, applyShapeKeys } from './shape-keys.js';
import { latticeFrame } from './lattice.js';
import { runStep } from './mesh.js';
import { applyStencil } from './topology.js';
import { surfaceDeformInto } from './surface-deform.js';
import { evaluatedPositions } from './targets.js';

const SPLINE_KIND = { KEY_LINEAR: 0, KEY_CARDINAL: 1, KEY_CATMULL_ROM: 2, KEY_BSPLINE: 3 };

// --- Passes: run(src, dst) on flat xyz Float64Arrays ---

// The Armature modifier from its group weights (armature-modifier.js bindModifier): per vertex and frame the B-Bone
// segment of the current input position, then a linear or dual quaternion blend in armature space, mixed into the
// input by the modifier's mask.
function armaturePass(inst, deform, mod) {
  const J = armatureJoints(inst, mod.arm);
  const bone = Int32Array.from(mod.bones, (b) => b.index);
  useBones(J, bone);
  const nv = mod.start.length - 1, mask = new Float64Array(nv), share = new Float64Array(mod.weight.length);
  for (let v = 0; v < nv; v++) {
    mask[v] = maskOf(mod, v);
    let W = 0;
    for (let i = mod.start[v]; i < mod.start[v + 1]; i++) if (mod.weight[i] > 0) W += mod.weight[i];
    for (let i = mod.start[v]; i < mod.start[v + 1]; i++) share[i] = W > 0 && mod.weight[i] > 0 ? mod.weight[i] / W : 0;
  }
  const pre = new Float64Array(16), preInv = new Float64Array(16), acc = new Float64Array(16);
  let list = null;
  const run = (src, dst) => {
    updateJoints(inst, J);
    if (mod.dq) updateDualQuats(inst, J);
    mulAffine(pre, 0, inst.worldInv, mod.arm * 16, inst.world, deform.mesh * 16);
    invertAffine(preInv, 0, pre, 0);
    const n = list ? list.length : nv;
    for (let i = 0; i < n; i++) {
      const v = list ? list[i] : i;
      const o = v * 3, cx = src[o], cy = src[o + 1], cz = src[o + 2], m = mask[v];
      const px = pre[0] * cx + pre[4] * cy + pre[8] * cz + pre[12];
      const py = pre[1] * cx + pre[5] * cy + pre[9] * cz + pre[13];
      const pz = pre[2] * cx + pre[6] * cy + pre[10] * cz + pre[14];
      acc.fill(0);
      let any = false;
      for (let r = mod.start[v]; r < mod.start[v + 1]; r++) {
        const w = share[r];
        if (!w) continue;
        any = true;
        const b = bone[mod.slot[r]], j0 = J.offset[b], segs = J.segments[b];
        if (segs <= 1) { addJoint(acc, J, j0, w, px, py, pz, mod.dq); continue; }
        const f = segmentAt(J, b, segs, j0, px, py, pz), k = Math.min(Math.floor(f), segs - 1), t = f - k;
        addJoint(acc, J, j0 + k, w * (1 - t), px, py, pz, mod.dq);
        addJoint(acc, J, j0 + k + 1, w * t, px, py, pz, mod.dq);
      }
      let qx = px, qy = py, qz = pz;
      if (any) {
        if (mod.dq) { dqResult(acc); qx = acc[12]; qy = acc[13]; qz = acc[14]; }
        else { qx = acc[0]; qy = acc[1]; qz = acc[2]; }
      }
      const bx = preInv[0] * qx + preInv[4] * qy + preInv[8] * qz + preInv[12];
      const by = preInv[1] * qx + preInv[5] * qy + preInv[9] * qz + preInv[13];
      const bz = preInv[2] * qx + preInv[6] * qy + preInv[10] * qz + preInv[14];
      dst[o] = cx + m * (bx - cx); dst[o + 1] = cy + m * (by - cy); dst[o + 2] = cz + m * (bz - cz);
    }
  };
  return { run, live: (out) => { list = liveList(out); return out; } };
}

// The indices set in a live mask, or null when all are.
function indicesWhere(n, keep) {
  const out = [];
  for (let i = 0; i < n; i++) if (keep(i)) out.push(i);
  return Int32Array.from(out);
}

function liveList(mask) {
  let n = 0;
  for (let i = 0; i < mask.length; i++) n += mask[i];
  if (n === mask.length) return null;
  const list = new Int32Array(n);
  for (let i = 0, k = 0; i < mask.length; i++) if (mask[i]) list[k++] = i;
  return list;
}

// Segment position 0..n of an armature-space point on a B-Bone: Straight (rest Y over the length) or Curved (the
// rest joints, armature-modifier.js segmentOf).
function segmentAt(J, b, n, j0, px, py, pz) {
  const B = J.B;
  if (!J.curved[b]) {
    const r = b * 16, R = J.restInv;
    const y = R[r + 1] * px + R[r + 5] * py + R[r + 9] * pz + R[r + 13];
    return Math.min(n, Math.max(0, (y / J.length[b]) * n));
  }
  let prev = 0;
  for (let j = 0; j <= n; j++) {
    const o = (j0 + j) * 16, s = (px - B[o + 12]) * B[o + 4] + (py - B[o + 13]) * B[o + 5] + (pz - B[o + 14]) * B[o + 6];
    if (j === 0) { if (s <= 0) return 0; prev = s; continue; }
    if (s <= 0) return j - 1 + prev / (prev - s);
    prev = s;
  }
  return n;
}

// Adds one joint's weighted contribution: linear blend (acc[0..2]), or dual quaternion sums (acc: Q 0..3, E 4..7,
// q * (0, S p) 8..11, the first q 12..15 for the sign; armature-modifier.js blendDQ).
function addJoint(acc, J, j, a, px, py, pz, dq) {
  if (!a) return;
  if (!dq) {
    const D = J.D, o = j * 16;
    acc[0] += a * (D[o] * px + D[o + 4] * py + D[o + 8] * pz + D[o + 12]);
    acc[1] += a * (D[o + 1] * px + D[o + 5] * py + D[o + 9] * pz + D[o + 13]);
    acc[2] += a * (D[o + 2] * px + D[o + 6] * py + D[o + 10] * pz + D[o + 14]);
    return;
  }
  const d = J.dq, o = j * 24;
  let qw = d[o], qx = d[o + 1], qy = d[o + 2], qz = d[o + 3], ew = d[o + 4], ex = d[o + 5], ey = d[o + 6], ez = d[o + 7];
  if (!acc[12] && !acc[13] && !acc[14] && !acc[15]) { acc[12] = qw; acc[13] = qx; acc[14] = qy; acc[15] = qz; }
  if (qw * acc[12] + qx * acc[13] + qy * acc[14] + qz * acc[15] < 0) { qw = -qw; qx = -qx; qy = -qy; qz = -qz; ew = -ew; ex = -ex; ey = -ey; ez = -ez; }
  const s = o + 8;
  const sx = d[s] * px + d[s + 4] * py + d[s + 8] * pz + d[s + 12];
  const sy = d[s + 1] * px + d[s + 5] * py + d[s + 9] * pz + d[s + 13];
  const sz = d[s + 2] * px + d[s + 6] * py + d[s + 10] * pz + d[s + 14];
  acc[0] += a * qw; acc[1] += a * qx; acc[2] += a * qy; acc[3] += a * qz;
  acc[4] += a * ew; acc[5] += a * ex; acc[6] += a * ey; acc[7] += a * ez;
  acc[8] += a * (-qx * sx - qy * sy - qz * sz);
  acc[9] += a * (qw * sx + qy * sz - qz * sy);
  acc[10] += a * (qw * sy - qx * sz + qz * sx);
  acc[11] += a * (qw * sz + qx * sy - qy * sx);
}

// The blended point ((A + 2E) * conj(Q)).xyz / |Q|^2 into acc[12..14].
function dqResult(acc) {
  const Qw = acc[0], Qx = acc[1], Qy = acc[2], Qz = acc[3], N = Qw * Qw + Qx * Qx + Qy * Qy + Qz * Qz;
  const Rw = acc[8] + 2 * acc[4], Rx = acc[9] + 2 * acc[5], Ry = acc[10] + 2 * acc[6], Rz = acc[11] + 2 * acc[7];
  acc[12] = (-Rw * Qx + Rx * Qw - Ry * Qz + Rz * Qy) / N;
  acc[13] = (-Rw * Qy + Rx * Qz + Ry * Qw - Rz * Qx) / N;
  acc[14] = (-Rw * Qz - Rx * Qy + Ry * Qx + Rz * Qw) / N;
}

function stencilPass(inst, deform, step, inCount) {
  const st = step.stencil, F = new Float64Array(16), Fi = new Float64Array(16), mirror = step.mirrorObject !== undefined;
  let list = null;
  const live = (out) => {
    list = liveList(out);
    const used = new Uint8Array(inCount);
    for (let i = 0; i < st.count; i++) if (out[i]) for (let k = st.start[i]; k < st.start[i + 1]; k++) used[st.src[k]] = 1;
    return used;
  };
  const run = (src, dst) => {
    if (mirror) {
      invertAffine(Fi, 0, inst.world, step.mirrorObject * 16);
      mulAffine(F, 0, Fi, 0, inst.world, deform.mesh * 16);
      invertAffine(Fi, 0, F, 0);
    }
    const n = list ? list.length : st.count;
    for (let r = 0; r < n; r++) {
      const i = list ? list[r] : r;
      let x = 0, y = 0, z = 0;
      for (let k = st.start[i]; k < st.start[i + 1]; k++) {
        const s = st.src[k] * 3, w = st.weight[k], f = st.flip[k];
        let px = src[s], py = src[s + 1], pz = src[s + 2];
        if (f) {
          if (mirror) { const ax = F[0] * px + F[4] * py + F[8] * pz + F[12], ay = F[1] * px + F[5] * py + F[9] * pz + F[13]; pz = F[2] * px + F[6] * py + F[10] * pz + F[14]; px = ax; py = ay; }
          if (f & 1) px = -px;
          if (f & 2) py = -py;
          if (f & 4) pz = -pz;
          if (mirror) { const ax = Fi[0] * px + Fi[4] * py + Fi[8] * pz + Fi[12], ay = Fi[1] * px + Fi[5] * py + Fi[9] * pz + Fi[13]; pz = Fi[2] * px + Fi[6] * py + Fi[10] * pz + Fi[14]; px = ax; py = ay; }
        }
        x += w * px; y += w * py; z += w * pz;
      }
      dst[i * 3] = x; dst[i * 3 + 1] = y; dst[i * 3 + 2] = z;
    }
  };
  return { run, live, count: st.count };
}

function latticePass(inst, deform, step) {
  const toLat = new Float64Array(16), back = new Float64Array(16), inv = new Float64Array(16);
  let list = null;
  const wu = new Float64Array(4), wv = new Float64Array(4), ww = new Float64Array(4), iu = new Int32Array(4), iv = new Int32Array(4), iw = new Int32Array(4);
  const run = (src, dst) => {
    const L = latticeFrame(inst, step.lattice), kinds = L.interp.map((k) => SPLINE_KIND[k] ?? 3);
    invertAffine(inv, 0, inst.world, step.lattice * 16);
    mulAffine(toLat, 0, inv, 0, inst.world, deform.mesh * 16);
    invertAffine(back, 0, toLat, 0);
    const count = list ? list.length : src.length / 3;
    for (let r = 0; r < count; r++) {
      const v = list ? list[r] : r, o = v * 3, x = src[o], y = src[o + 1], z = src[o + 2];
      const px = toLat[0] * x + toLat[4] * y + toLat[8] * z + toLat[12];
      const py = toLat[1] * x + toLat[5] * y + toLat[9] * z + toLat[13];
      const pz = toLat[2] * x + toLat[6] * y + toLat[10] * z + toLat[14];
      const nu = axisWeights(iu, wu, L.nu, L.range[0][0], L.range[0][1], px, kinds[0]);
      const nv = axisWeights(iv, wv, L.nv, L.range[1][0], L.range[1][1], py, kinds[1]);
      const nw = axisWeights(iw, ww, L.nw, L.range[2][0], L.range[2][1], pz, kinds[2]);
      let dx = 0, dy = 0, dz = 0, g = 0;
      for (let c = 0; c < nw; c++) for (let b = 0; b < nv; b++) for (let a = 0; a < nu; a++) {
        const w = wu[a] * wv[b] * ww[c];
        if (!w) continue;
        const i = iu[a] + L.nu * (iv[b] + L.nv * iw[c]);
        dx += w * L.disp[i * 3]; dy += w * L.disp[i * 3 + 1]; dz += w * L.disp[i * 3 + 2];
        if (L.group) g += w * (L.group[i] ?? 0);
      }
      const s = L.group ? g : 1, qx = px + s * dx, qy = py + s * dy, qz = pz + s * dz;
      const f = step.strength * (step.mask ? step.mask[v] : 1);
      for (let a = 0; a < 3; a++) {
        const d = back[a] * qx + back[4 + a] * qy + back[8 + a] * qz + back[12 + a];
        dst[o + a] = src[o + a] + f * (d - src[o + a]);
      }
    }
  };
  return { run, live: (out) => { list = liveList(out); return out; } };
}

// Per axis into (idx, w): the clamped point indices and weights of a coordinate; returns how many.
function axisWeights(idx, w, n, lo, hi, x, kind) {
  if (n <= 1) { idx[0] = 0; w[0] = 1; return 1; }
  const f = ((x - lo) / (hi - lo)) * (n - 1), k = Math.floor(f), t = f - k, t2 = t * t, t3 = t2 * t;
  if (kind === 0) { w[0] = 0; w[1] = 1 - t; w[2] = t; w[3] = 0; }
  else if (kind === 3) { w[0] = (1 - t) ** 3 / 6; w[1] = (3 * t3 - 6 * t2 + 4) / 6; w[2] = (-3 * t3 + 3 * t2 + 3 * t + 1) / 6; w[3] = t3 / 6; }
  else {
    const s = kind === 1 ? 0.71 : 0.5;
    w[0] = s * (-t3 + 2 * t2 - t); w[1] = (2 - s) * t3 + (s - 3) * t2 + 1; w[2] = (s - 2) * t3 + (3 - 2 * s) * t2 + s * t; w[3] = s * (t3 - t2);
  }
  for (let i = 0; i < 4; i++) idx[i] = Math.min(n - 1, Math.max(0, k - 1 + i));
  return 4;
}

function correctiveSmoothPass(step, count) {
  const nbStart = new Int32Array(count + 1), nbList = [];
  step.neighbours.forEach((list, v) => { nbStart[v] = nbList.length; nbList.push(...list); });
  nbStart[count] = nbList.length;
  const nb = Int32Array.from(nbList), factor = step.factor, lengthWeighted = step.lengthWeighted;
  // Faces as CSR, and per face corner the rest offset in the rest corner frame (Fr^T (R - Rs)), static.
  const R = step.rest, Rs = step.restSmooth, { fStart, fIdx } = faceRows(step.faces), offset = new Float64Array(fIdx.length * 3);
  for (let f = 0; f < fStart.length - 1; f++) {
    const s = fStart[f], e = fStart[f + 1];
    for (let i = s; i < e; i++) {
      const v = fIdx[i], o = v * 3;
      cornerFrame(FRAME, Rs, v, fIdx[i > s ? i - 1 : e - 1], fIdx[i + 1 < e ? i + 1 : s]);
      const ox = R[o] - Rs[o], oy = R[o + 1] - Rs[o + 1], oz = R[o + 2] - Rs[o + 2];
      for (let c = 0; c < 3; c++) offset[i * 3 + c] = FRAME[c * 3] * ox + FRAME[c * 3 + 1] * oy + FRAME[c * 3 + 2] * oz;
    }
  }
  const a = new Float64Array(count * 3), b = new Float64Array(count * 3), acc = new Float64Array(count * 4);
  // A vertex with factor 0 keeps its position through the smoothing, so its rest offset is 0 and the correction
  // leaves it too: it is copied, not smoothed (most of Snow's body and shirt, by their no_smooth groups).
  const moving = Uint8Array.from(factor, (f) => (f ? 1 : 0));
  // Live vertices: the output's (outList), and the smoothing's, that output widened by iterations + 1 rings (a
  // corner reads its neighbours' smoothed positions); faces with a live moving vertex.
  let outList = null, smoothList = null, copyList = null, faces = null;
  const live = (out) => {
    outList = liveList(out);
    let ring = out;
    for (let r = 0; r <= step.iterations; r++) {
      const wider = Uint8Array.from(ring);
      for (let v = 0; v < count; v++) if (ring[v]) for (let k = nbStart[v]; k < nbStart[v + 1]; k++) wider[nb[k]] = 1;
      ring = wider;
    }
    smoothList = indicesWhere(count, (v) => ring[v] && moving[v]);
    copyList = indicesWhere(count, (v) => ring[v] && !moving[v]);
    faces = indicesWhere(fStart.length - 1, (f) => {
      for (let i = fStart[f]; i < fStart[f + 1]; i++) if (out[fIdx[i]] && moving[fIdx[i]]) return true;
      return false;
    });
    return ring;
  };
  const run = (src, dst) => {
    for (let r = 0; r < copyList.length; r++) {
      const o = copyList[r] * 3;
      a[o] = b[o] = src[o]; a[o + 1] = b[o + 1] = src[o + 1]; a[o + 2] = b[o + 2] = src[o + 2];
    }
    let P = src, next = a;
    for (let it = 0; it < step.iterations; it++) {
      smoothOnce(P, next, nbStart, nb, factor, lengthWeighted, smoothList);
      P = next; next = next === a ? b : a;
    }
    if (step.onlySmooth) { dst.set(P); return; }
    acc.fill(0);
    correctCorners(acc, P, fStart, fIdx, offset, faces, moving);
    const n = outList ? outList.length : count;
    for (let r = 0; r < n; r++) {
      const v = outList ? outList[r] : r, o = v * 3, total = acc[v * 4 + 3], k = total ? step.scale / total : 0;
      dst[o] = P[o] + k * acc[v * 4]; dst[o + 1] = P[o + 1] + k * acc[v * 4 + 1]; dst[o + 2] = P[o + 2] + k * acc[v * 4 + 2];
    }
  };
  return { run, live };
}

// Per face corner of the smoothed mesh P: its frame (cornerFrame) applied to the corner's rest offset, weighted by
// pi minus the corner angle, summed per vertex into acc (x, y, z, total). Edge directions are shared by the corners.
function correctCorners(acc, P, fStart, fIdx, offset, faces, moving) {
  const E = EDGES, nf = faces ? faces.length : fStart.length - 1;
  for (let r = 0; r < nf; r++) {
    const f = faces ? faces[r] : r, s = fStart[f], e = fStart[f + 1], n = e - s;
    for (let i = 0; i < n; i++) {
      const a = fIdx[s + i] * 3, b = fIdx[i + 1 < n ? s + i + 1 : s] * 3;
      let x = P[b] - P[a], y = P[b + 1] - P[a + 1], z = P[b + 2] - P[a + 2];
      const l = Math.sqrt(x * x + y * y + z * z) || 1;
      E[i * 3] = x / l; E[i * 3 + 1] = y / l; E[i * 3 + 2] = z / l;
    }
    for (let i = 0; i < n; i++) {
      // e1 towards the next vertex, e2 towards the previous one.
      const p = (i ? i - 1 : n - 1) * 3, v = fIdx[s + i];
      if (!moving[v]) continue;
      const e1x = E[i * 3], e1y = E[i * 3 + 1], e1z = E[i * 3 + 2], e2x = -E[p], e2y = -E[p + 1], e2z = -E[p + 2];
      let zx = e1y * e2z - e1z * e2y, zy = e1z * e2x - e1x * e2z, zz = e1x * e2y - e1y * e2x;
      let l = Math.sqrt(zx * zx + zy * zy + zz * zz) || 1; zx /= l; zy /= l; zz /= l;
      let xx = e1x + e2x, xy = e1y + e2y, xz = e1z + e2z;
      const d = xx * zx + xy * zy + xz * zz;
      xx -= d * zx; xy -= d * zy; xz -= d * zz;
      l = Math.sqrt(xx * xx + xy * xy + xz * xz) || 1; xx /= l; xy /= l; xz /= l;
      const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
      const w = Math.PI - Math.acos(Math.max(-1, Math.min(1, e1x * e2x + e1y * e2y + e1z * e2z)));
      const k = (s + i) * 3, lx = offset[k], ly = offset[k + 1], lz = offset[k + 2], o = v * 4;
      acc[o] += w * (xx * lx + yx * ly + zx * lz);
      acc[o + 1] += w * (xy * lx + yy * ly + zy * lz);
      acc[o + 2] += w * (xz * lx + yz * ly + zz * lz);
      acc[o + 3] += w;
    }
  }
}

let EDGES = new Float64Array(3 * 64);

function faceRows(faces) {
  const fStart = new Int32Array(faces.length + 1), fIdx = [];
  faces.forEach((f, i) => { fStart[i] = fIdx.length; fIdx.push(...f); if (f.length * 3 > EDGES.length) EDGES = new Float64Array(f.length * 3); });
  fStart[faces.length] = fIdx.length;
  return { fStart, fIdx: Int32Array.from(fIdx) };
}

function smoothOnce(P, out, start, nb, factor, lengthWeighted, list) {
  for (let r = 0; r < list.length; r++) {
    const v = list[r];
    const f = factor[v], s0 = start[v], s1 = start[v + 1], count = s1 - s0;
    const px = P[v * 3], py = P[v * 3 + 1], pz = P[v * 3 + 2];
    let sx = 0, sy = 0, sz = 0;
    if (f && count) {
      if (lengthWeighted) {
        let total = 0;
        for (let k = s0; k < s1; k++) {
          const j = nb[k] * 3, dx = P[j] - px, dy = P[j + 1] - py, dz = P[j + 2] - pz, l = Math.sqrt(dx * dx + dy * dy + dz * dz);
          sx += l * dx; sy += l * dy; sz += l * dz; total += l;
        }
        const k = total ? 2 / count / total : 0;
        sx *= k; sy *= k; sz *= k;
      } else {
        for (let k = s0; k < s1; k++) { const j = nb[k] * 3; sx += P[j] - px; sy += P[j + 1] - py; sz += P[j + 2] - pz; }
        sx /= count; sy /= count; sz /= count;
      }
    }
    out[v * 3] = px + f * sx; out[v * 3 + 1] = py + f * sy; out[v * 3 + 2] = pz + f * sz;
  }
}

const FRAME = new Float64Array(9);

// The corner frame at v (columns X, Y, Z into F) from its previous and next vertex; returns the corner's weight,
// pi minus its angle (corrective-smooth.js).
function cornerFrame(F, P, v, prev, next) {
  const vx = P[v * 3], vy = P[v * 3 + 1], vz = P[v * 3 + 2];
  let ax = P[next * 3] - vx, ay = P[next * 3 + 1] - vy, az = P[next * 3 + 2] - vz;
  let bx = P[prev * 3] - vx, by = P[prev * 3 + 1] - vy, bz = P[prev * 3 + 2] - vz;
  let l = Math.sqrt(ax * ax + ay * ay + az * az) || 1; ax /= l; ay /= l; az /= l;
  l = Math.sqrt(bx * bx + by * by + bz * bz) || 1; bx /= l; by /= l; bz /= l;
  let zx = ay * bz - az * by, zy = az * bx - ax * bz, zz = ax * by - ay * bx;
  l = Math.sqrt(zx * zx + zy * zy + zz * zz) || 1; zx /= l; zy /= l; zz /= l;
  let xx = ax + bx, xy = ay + by, xz = az + bz;
  const d = xx * zx + xy * zy + xz * zz;
  xx -= d * zx; xy -= d * zy; xz -= d * zz;
  l = Math.sqrt(xx * xx + xy * xy + xz * xz) || 1; xx /= l; xy /= l; xz /= l;
  F[0] = xx; F[1] = xy; F[2] = xz;
  F[3] = zy * xz - zz * xy; F[4] = zz * xx - zx * xz; F[5] = zx * xy - zy * xx;
  F[6] = zx; F[7] = zy; F[8] = zz;
  return Math.PI - Math.acos(Math.max(-1, Math.min(1, ax * bx + ay * by + az * bz)));
}

function surfaceDeformPass(inst, step) {
  const run = (src, dst) => { dst.set(src); surfaceDeformInto(dst, src, step, evaluatedPositions(inst, step.target)); };
  return { run, live: (out) => out };
}

// A step mesh.js runs: positions copied in and out, with its ctx (Multi Modifier's input).
function referencePass(inst, deform, step, ctx) {
  return { run: (src, dst) => dst.set(runStep(inst, deform, step, src, ctx)), reference: true, live: (out, inCount) => new Uint8Array(inCount).fill(1) };
}

// --- Shape keys ---

// Relative keys as sparse (vertex, weighted delta) lists; Absolute keys through shape-keys.js.
export function shapeKeyInput(inst, deform) {
  const sk = deform.shapeKeys;
  if (!sk) return (out) => out.set(deform.base);
  if (sk.use_relative === false) return (out) => out.set(applyShapeKeys(inst, deform));
  const mesh = inst.program.objects[deform.mesh];
  const terms = relativeTerms(sk.key_blocks, new Map((mesh.data.vertex_groups ?? []).map((g) => [g.name, g.weights]))).map((t) => {
    const idx = [], d = [];
    for (let v = 0; v < t.delta.length / 3; v++) {
      const g = t.group ? t.group[v] ?? 0 : 1;
      const x = g * t.delta[v * 3], y = g * t.delta[v * 3 + 1], z = g * t.delta[v * 3 + 2];
      if (x || y || z) { idx.push(v * 3); d.push(x, y, z); }
    }
    return { key: t.key, idx: Int32Array.from(idx), d: Float64Array.from(d) };
  });
  const basis = sk.key_blocks[0].co;
  return (out) => {
    out.set(basis);
    for (const t of terms) {
      if (t.key.mute) continue;
      const value = keyValue(t.key, inst.shapeKeyValue?.(deform.mesh, t.key.name));
      if (!value) continue;
      const { idx, d } = t;
      for (let k = 0; k < idx.length; k++) {
        const o = idx[k];
        out[o] += value * d[k * 3]; out[o + 1] += value * d[k * 3 + 1]; out[o + 2] += value * d[k * 3 + 2];
      }
    }
  };
}

// --- The stack ---

export class CpuStack {
  constructor(inst, deform, { axis = null, normals = true } = {}) {
    this.inst = inst; this.deform = deform;
    this.axis = axis ? Float64Array.from(axis.m ?? axis) : null;
    this.input = shapeKeyInput(inst, deform);
    let rest = deform.shapeKeys ? applyShapeKeys(inst, deform) : Float64Array.from(deform.base), count = rest.length / 3;
    this.first = new Float64Array(count * 3);
    this.passes = [];
    const ctx = { prevIn: null, armatureCount: 0 };
    let armatures = 0;
    for (const step of deform.steps) {
      let pass;
      if (step.type === 'ARMATURE' && !(step.multi && armatures > 0) && !step.useEnvelopes) pass = armaturePass(inst, deform, step);
      else if (step.stencil) pass = stencilPass(inst, deform, step, count);
      else if (step.type === 'LATTICE') pass = latticePass(inst, deform, step);
      else if (step.type === 'CORRECTIVE_SMOOTH') pass = correctiveSmoothPass(step, count);
      else if (step.type === 'SURFACE_DEFORM') pass = surfaceDeformPass(inst, step);
      else pass = referencePass(inst, deform, step, ctx);
      if (step.type === 'ARMATURE') armatures++;
      const n = pass.count ?? count;
      this.passes.push({ ...pass, step, out: new Float64Array(n * 3), inCount: count });
      if (step.stencil) rest = applyStencil(step.stencil, rest, step.mirrorObject === undefined ? null : inst.program.restFrame(deform.mesh, step.mirrorObject));
      count = n;
    }
    // Work only on vertices the end result depends on (a Mask after the smoothing drops most of a body).
    let live = new Uint8Array(count).fill(1);
    for (let i = this.passes.length - 1; i >= 0; i--) live = this.passes[i].live(live, this.passes[i].inCount);
    // Multi Modifier reads the previous Armature's input: tracked only when a reference Armature pass needs it.
    this.ctx = this.passes.some((p) => p.reference && p.step.type === 'ARMATURE') ? ctx : null;
    this.count = count;
    const draw = deform.draw, drawn = draw ? draw.length : count;
    this.positions = new Float32Array(drawn * 3);
    this.normals = normals && deform.geo.faces.length ? new Float32Array(drawn * 3) : null;
    if (this.normals) this.normalData = normalTopology(deform.geo.faces, count);
  }

  // The stack for this frame (after inst.evaluate()): this.welded (Float64Array, evaluated mesh) and the drawn
  // positions and normals (Float32Array, through draw_vertices and axis).
  run() {
    this.input(this.first);
    let cur = this.first;
    const ctx = this.ctx;
    if (ctx) { ctx.prevIn = cur; ctx.armatureCount = 0; }
    for (const p of this.passes) {
      p.run(cur, p.out);
      if (ctx) trackMulti(ctx, p.step, cur, p.out);
      cur = p.out;
    }
    this.welded = cur;
    writeDrawn(this.positions, cur, this.deform.draw, this.axis, 1);
    if (this.normals) {
      const N = this.normalData;
      vertexNormalsInto(N.vertexN, cur, N);
      writeDrawn(this.normals, N.vertexN, this.deform.draw, this.axis, 0);
    }
    return this.positions;
  }
}

// deformMesh's ctx bookkeeping (mesh.js runArmature, runStencil) for reference passes after fast ones.
function trackMulti(ctx, step, input, out) {
  if (step.type === 'ARMATURE') { ctx.prevIn = Float64Array.from(input); ctx.armatureCount++; }
  else if (step.stencil) ctx.prevIn = Float64Array.from(out);
}

function writeDrawn(out, P, draw, m, w) {
  const n = out.length / 3;
  for (let i = 0; i < n; i++) {
    const s = (draw ? draw[i] : i) * 3, x = P[s], y = P[s + 1], z = P[s + 2];
    if (!m) { out[i * 3] = x; out[i * 3 + 1] = y; out[i * 3 + 2] = z; continue; }
    out[i * 3] = m[0] * x + m[4] * y + m[8] * z + m[12] * w;
    out[i * 3 + 1] = m[1] * x + m[5] * y + m[9] * z + m[13] * w;
    out[i * 3 + 2] = m[2] * x + m[6] * y + m[10] * z + m[14] * w;
  }
}

function normalTopology(faces, count) {
  return { ...faceRows(faces), vertexN: new Float64Array(count * 3) };
}

// Vertex normals as displace.js vertexNormals: Newell face normals weighted by the corner angle, normalized.
function vertexNormalsInto(n, P, { fStart, fIdx }) {
  n.fill(0);
  const E = EDGES;
  for (let f = 0; f < fStart.length - 1; f++) {
    const s = fStart[f], e = fStart[f + 1], cnt = e - s;
    let nx = 0, ny = 0, nz = 0;
    for (let i = 0; i < cnt; i++) {
      const a = fIdx[s + i] * 3, b = fIdx[i + 1 < cnt ? s + i + 1 : s] * 3;
      nx += (P[a + 1] - P[b + 1]) * (P[a + 2] + P[b + 2]);
      ny += (P[a + 2] - P[b + 2]) * (P[a] + P[b]);
      nz += (P[a] - P[b]) * (P[a + 1] + P[b + 1]);
      const x = P[b] - P[a], y = P[b + 1] - P[a + 1], z = P[b + 2] - P[a + 2], l = Math.sqrt(x * x + y * y + z * z) || 1;
      E[i * 3] = x / l; E[i * 3 + 1] = y / l; E[i * 3 + 2] = z / l;
    }
    const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    nx /= l; ny /= l; nz /= l;
    for (let i = 0; i < cnt; i++) {
      const p = (i ? i - 1 : cnt - 1) * 3, o = fIdx[s + i] * 3;
      const c = -(E[i * 3] * E[p] + E[i * 3 + 1] * E[p + 1] + E[i * 3 + 2] * E[p + 2]);
      const angle = Math.acos(Math.max(-1, Math.min(1, c)));
      n[o] += angle * nx; n[o + 1] += angle * ny; n[o + 2] += angle * nz;
    }
  }
  for (let o = 0; o < n.length; o += 3) {
    const l = Math.sqrt(n[o] * n[o] + n[o + 1] * n[o + 1] + n[o + 2] * n[o + 2]) || 1;
    n[o] /= l; n[o + 1] /= l; n[o + 2] /= l;
  }
}
