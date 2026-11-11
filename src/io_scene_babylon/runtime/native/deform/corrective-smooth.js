// @ts-nocheck
// SPDX-License-Identifier: MIT OR Apache-2.0
// From babylon-blender-rig (scripts/native-rig.mjs).
// The Corrective Smooth modifier (specs/corrective_smooth.md): smoothing over the mesh edges (exact), and the rest
// offsets carried by per-corner frames (the spec's approximate correction, within 1.6e-3 of Blender on its cases).
// Topology comes from the mesh data: `faces` (vertex index lists) and optional `edges` (derived from faces if absent).
import { maskWeights } from './weights.js';

export function bindCorrectiveSmooth(program, ob, m, geo) {
  const { faces, base } = geo;
  const edgeSet = new Map();
  const addEdge = (a, b) => { const k = a < b ? `${a}/${b}` : `${b}/${a}`; edgeSet.set(k, (edgeSet.get(k) ?? 0) + 1); };
  for (const f of faces) f.forEach((v, i) => addEdge(v, f[(i + 1) % f.length]));
  for (const [a, b] of geo.edges) if (!edgeSet.has(a < b ? `${a}/${b}` : `${b}/${a}`)) edgeSet.set(a < b ? `${a}/${b}` : `${b}/${a}`, 0);
  const nv = base.length / 3;
  const neighbours = Array.from({ length: nv }, () => []);
  const boundary = new Uint8Array(nv);
  for (const [k, uses] of edgeSet) {
    const [a, b] = k.split('/').map(Number);
    neighbours[a].push(b); neighbours[b].push(a);
    if (uses === 1) boundary[a] = boundary[b] = 1;
  }
  const corners = Array.from({ length: nv }, () => []);
  for (const f of faces) f.forEach((v, i) => corners[v].push([f[(i + f.length - 1) % f.length], f[(i + 1) % f.length]]));
  const factor = new Float64Array(nv), mask = maskWeights(geo, m);
  for (let v = 0; v < nv; v++) factor[v] = (m.use_pin_boundary && boundary[v] ? 0 : 1) * (m.factor ?? 0.5) * (mask ? mask[v] : 1);
  const settings = { iterations: m.iterations ?? 5, scale: m.scale ?? 1, lengthWeighted: m.smooth_type === 'LENGTH_WEIGHTED', onlySmooth: !!m.use_only_smooth };
  const step = { neighbours, corners, factor, ...settings };
  // Rest: the mesh's own positions (rest_source ORCO), smoothed once.
  step.rest = base;
  step.restSmooth = smooth(base, step);
  return step;
}

export function smooth(positions, step) {
  let P = Float64Array.from(positions), next = new Float64Array(P.length);
  const n = P.length / 3;
  for (let it = 0; it < step.iterations; it++) {
    for (let v = 0; v < n; v++) {
      const nb = step.neighbours[v], f = step.factor[v];
      let sx = 0, sy = 0, sz = 0;
      if (f && nb.length) {
        if (step.lengthWeighted) {
          let total = 0;
          for (const j of nb) {
            const dx = P[j * 3] - P[v * 3], dy = P[j * 3 + 1] - P[v * 3 + 1], dz = P[j * 3 + 2] - P[v * 3 + 2], l = Math.sqrt(dx * dx + dy * dy + dz * dz);
            sx += l * dx; sy += l * dy; sz += l * dz; total += l;
          }
          const k = total ? 2 / nb.length / total : 0;
          sx *= k; sy *= k; sz *= k;
        } else {
          for (const j of nb) { sx += P[j * 3] - P[v * 3]; sy += P[j * 3 + 1] - P[v * 3 + 1]; sz += P[j * 3 + 2] - P[v * 3 + 2]; }
          sx /= nb.length; sy /= nb.length; sz /= nb.length;
        }
      }
      next[v * 3] = P[v * 3] + f * sx; next[v * 3 + 1] = P[v * 3 + 1] + f * sy; next[v * 3 + 2] = P[v * 3 + 2] + f * sz;
    }
    [P, next] = [next, P];
  }
  return P;
}

// A corner frame at v (columns X, Y, Z) from the previous and next vertex of a face.
function cornerFrame(P, v, prev, next) {
  const e1 = norm(sub(P, next, v)), e2 = norm(sub(P, prev, v));
  const z = norm(cross(e1, e2));
  let x = [e1[0] + e2[0], e1[1] + e2[1], e1[2] + e2[2]];
  const d = x[0] * z[0] + x[1] * z[1] + x[2] * z[2];
  x = norm([x[0] - d * z[0], x[1] - d * z[1], x[2] - d * z[2]]);
  return [x, cross(z, x), z];
}
const sub = (P, a, b) => [P[a * 3] - P[b * 3], P[a * 3 + 1] - P[b * 3 + 1], P[a * 3 + 2] - P[b * 3 + 2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

export function runCorrectiveSmooth(inst, mesh, step, cur) {
  const Ds = smooth(cur, step);
  if (step.onlySmooth) return Ds;
  const { rest: R, restSmooth: Rs } = step, out = Float64Array.from(Ds);
  for (let v = 0; v < cur.length / 3; v++) {
    const cs = step.corners[v];
    if (!cs.length) continue;
    const off = [R[v * 3] - Rs[v * 3], R[v * 3 + 1] - Rs[v * 3 + 1], R[v * 3 + 2] - Rs[v * 3 + 2]];
    const acc = [0, 0, 0];
    for (const [prev, next] of cs) {
      const Fr = cornerFrame(Rs, v, prev, next), Fd = cornerFrame(Ds, v, prev, next);
      const local = Fr.map((c) => c[0] * off[0] + c[1] * off[1] + c[2] * off[2]); // Fr^T off
      for (let a = 0; a < 3; a++) acc[a] += Fd[0][a] * local[0] + Fd[1][a] * local[1] + Fd[2][a] * local[2];
    }
    for (let a = 0; a < 3; a++) out[v * 3 + a] += (step.scale * acc[a]) / cs.length;
  }
  return out;
}
