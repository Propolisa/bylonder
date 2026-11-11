// @ts-nocheck
// SPDX-License-Identifier: MIT OR Apache-2.0
// From babylon-blender-rig (scripts/native-rig.mjs).
// Shrinkwrap (specs/shrinkwrap.md), modifier and the shared surface queries the constraint uses. All work happens in
// the target object's space. The target's surface is its evaluated mesh (its own deform stack when it has one).
import { mulAffine, invertAffine } from '../rig/m4.js';
import { vertexNormals } from './displace.js';
import { maskWeights } from './weights.js';

// Triangles (fans from each face's first vertex) and angle-weighted vertex normals of a target mesh.
export function surfaceOf(P, faces) {
  const tris = [];
  for (const f of faces) for (let i = 1; i + 1 < f.length; i++) tris.push([f[0], f[i], f[i + 1]]);
  return { P, tris, normals: vertexNormals(P, faces) };
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const at = (P, i) => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]];
const norm = (a) => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// Closest point on triangle abc to p, with barycentric weights (Ericson, Real-Time Collision Detection 5.1.5).
function closestOnTriangle(p, a, b, c) {
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a);
  const d1 = dot(ab, ap), d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return [1, 0, 0];
  const bp = sub(p, b), d3 = dot(ab, bp), d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return [0, 1, 0];
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); return [1 - v, v, 0]; }
  const cp = sub(p, c), d5 = dot(ab, cp), d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return [0, 0, 1];
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); return [1 - w, 0, w]; }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / (d4 - d3 + (d5 - d6)); return [0, 1 - w, w]; }
  const den = 1 / (va + vb + vc), v = vb * den, w = vc * den;
  return [1 - v - w, v, w];
}

const mix = (P, t, w) => [0, 1, 2].map((k) => w[0] * P[t[0] * 3 + k] + w[1] * P[t[1] * 3 + k] + w[2] * P[t[2] * 3 + k]);

// Nearest surface point: { q, n (face normal), smooth (interpolated vertex normal) }.
export function nearestSurface(S, p) {
  let best = null, bestD = Infinity;
  for (const t of S.tris) {
    const w = closestOnTriangle(p, at(S.P, t[0]), at(S.P, t[1]), at(S.P, t[2])), q = mix(S.P, t, w), d = dot(sub(p, q), sub(p, q));
    if (d < bestD) { bestD = d; best = { t, w, q }; }
  }
  const [a, b, c] = best.t.map((i) => at(S.P, i));
  return { q: best.q, n: norm(cross(sub(b, a), sub(c, a))), smooth: norm(mix(S.normals, best.t, best.w)) };
}

export function nearestVertex(S, p) {
  let best = 0, bestD = Infinity;
  for (let i = 0; i < S.P.length / 3; i++) { const d = sub(p, at(S.P, i)), l = dot(d, d); if (l < bestD) { bestD = l; best = i; } }
  return { q: at(S.P, best) };
}

// The snap rules of the wrap modes (spec table).
export function wrap(p, hit, mode, off) {
  const d = Math.hypot(...sub(p, hit.q)), dir = d ? sub(p, hit.q).map((x) => x / d) : [0, 0, 0];
  const along = (k) => hit.q.map((x, i) => x + k * dir[i]);
  if (!hit.n) return along(off); // nearest vertex: no snap modes
  const side = dot(sub(p, hit.q), hit.n);
  switch (mode) {
    case 'OUTSIDE_SURFACE': return along(side >= 0 ? off : -off);
    case 'ABOVE_SURFACE': return hit.q.map((x, i) => x + off * hit.smooth[i]);
    case 'INSIDE': return side < 0 && d >= off ? p : along(side < 0 ? off : -off);
    case 'OUTSIDE': return side > 0 && d >= off ? p : along(side > 0 ? off : -off);
    default: return along(off);
  }
}

// Closest ray hit (Moller-Trumbore) along dir from p, with face culling; null when nothing is hit.
export function raycast(S, p, dir, cull = 'OFF') {
  let best = null;
  for (const t of S.tris) {
    const [a, b, c] = t.map((i) => at(S.P, i));
    const e1 = sub(b, a), e2 = sub(c, a), n = cross(e1, e2);
    if (cull === 'BACK' && dot(n, dir) > 0) continue;
    if (cull === 'FRONT' && dot(n, dir) < 0) continue;
    const h = cross(dir, e2), det = dot(e1, h);
    if (Math.abs(det) < 1e-12) continue;
    const s = sub(p, a), u = dot(s, h) / det;
    if (u < 0 || u > 1) continue;
    const q = cross(s, e1), v = dot(dir, q) / det;
    if (v < 0 || u + v > 1) continue;
    const dist = dot(e2, q) / det;
    if (dist >= 0 && (!best || dist < best.dist)) best = { dist, q: p.map((x, i) => x + dist * dir[i]), n: norm(n) };
  }
  return best;
}

// --- modifier ---

export function bindShrinkwrap(program, ob, m, geo) {
  const target = program.objectIndex.get(m.target);
  if (target === undefined || program.objects[target].type !== 'MESH') return null;
  const method = m.wrap_method ?? 'NEAREST_SURFACEPOINT';
  if (method === 'TARGET_PROJECT' || m.auxiliary_target) return { unsupported: `Shrinkwrap ${method}${m.auxiliary_target ? ' with an auxiliary target' : ''}` };
  return { target, method, mode: m.wrap_mode ?? 'ON_SURFACE', offset: m.offset ?? 0, mask: maskWeights(geo, m), m };
}

export function targetSurface(inst, target) {
  const ob = inst.program.objects[target];
  const P = inst.targetPositions?.(target) ?? Float64Array.from(ob.data.vertices);
  return surfaceOf(P, ob.data.faces ?? []);
}

export function runShrinkwrap(inst, mesh, step, cur) {
  const S = targetSurface(inst, step.target), m = step.m;
  const toT = new Float64Array(16), inv = new Float64Array(16), back = new Float64Array(16);
  invertAffine(inv, 0, inst.world, step.target * 16);
  mulAffine(toT, 0, inv, 0, inst.world, mesh * 16);
  invertAffine(back, 0, toT, 0);
  const apply = (M, p) => [0, 1, 2].map((r) => M[r] * p[0] + M[4 + r] * p[1] + M[8 + r] * p[2] + M[12 + r]);
  let rayDir = null;
  if (step.method === 'PROJECT') {
    const axes = [m.use_project_x, m.use_project_y, m.use_project_z].map(Boolean);
    const local = norm(axes.map((on) => +on));
    rayDir = norm([0, 1, 2].map((r) => toT[r] * local[0] + toT[4 + r] * local[1] + toT[8 + r] * local[2]));
  }
  const out = Float64Array.from(cur);
  for (let v = 0; v < cur.length / 3; v++) {
    const pm = at(cur, v), p = apply(toT, pm);
    let r;
    if (step.method === 'NEAREST_VERTEX') r = wrap(p, nearestVertex(S, p), step.mode, step.offset);
    else if (step.method === 'PROJECT') {
      const hits = [];
      if (m.use_positive_direction !== false) hits.push(raycast(S, p, rayDir, m.cull_face ?? 'OFF'));
      if (m.use_negative_direction) {
        const cull = m.use_invert_cull ? { BACK: 'FRONT', FRONT: 'BACK' }[m.cull_face] ?? 'OFF' : m.cull_face ?? 'OFF';
        hits.push(raycast(S, p, rayDir.map((x) => -x), cull));
      }
      const hit = hits.filter(Boolean).sort((a, b) => a.dist - b.dist)[0];
      if (!hit) continue;
      const q = apply(back, hit.q);
      if ((m.project_limit ?? 0) > 0 && Math.hypot(...sub(q, pm)) > m.project_limit) continue;
      // An offset with Project is not in the spec: taken along the hit face's normal.
      r = hit.q.map((x, i) => x + step.offset * hit.n[i]);
    } else r = wrap(p, nearestSurface(S, p), step.mode, step.offset);
    const res = apply(back, r), w = step.mask ? step.mask[v] : 1;
    for (let i = 0; i < 3; i++) out[v * 3 + i] = cur[v * 3 + i] + w * (res[i] - cur[v * 3 + i]);
  }
  return out;
}
