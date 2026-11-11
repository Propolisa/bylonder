// @ts-nocheck
// SPDX-License-Identifier: MIT OR Apache-2.0
// From babylon-blender-rig (scripts/native-rig.mjs).
// The Lattice modifier (specs/lattice.md). A lattice object's data: points_u/v/w, interpolation_type_u/v/w, the rest
// points `co` and deformed points `co_deform` (lattice space, U fastest), vertex_group and vertex_groups. A lattice
// with its own modifiers (an Armature) deforms its points first, as a mesh would.
import { mulAffine, invertAffine } from '../rig/m4.js';
import { maskWeights } from './weights.js';

const SPLINE = {
  KEY_LINEAR: (t) => [0, 1 - t, t, 0],
  KEY_CARDINAL: (t) => cardinal(t, 0.71),
  KEY_CATMULL_ROM: (t) => cardinal(t, 0.5),
  KEY_BSPLINE: (t) => [(1 - t) ** 3 / 6, (3 * t ** 3 - 6 * t ** 2 + 4) / 6, (-3 * t ** 3 + 3 * t ** 2 + 3 * t + 1) / 6, t ** 3 / 6],
};
function cardinal(t, s) {
  return [s * (-(t ** 3) + 2 * t * t - t), (2 - s) * t ** 3 + (s - 3) * t * t + 1, (s - 2) * t ** 3 + (3 - 2 * s) * t * t + s * t, s * (t ** 3 - t * t)];
}

export function bindLattice(program, ob, m, geo) {
  const lattice = program.objectIndex.get(m.object);
  if (lattice === undefined || program.objects[lattice].type !== 'LATTICE') return null;
  return { lattice, strength: m.strength ?? 1, mask: maskWeights(geo, m) };
}

// Per axis: the point indices (clamped) and weights of a coordinate.
function axisWeights(n, lo, hi, x, interp) {
  if (n <= 1) return [[0], [1]];
  const f = ((x - lo) / (hi - lo)) * (n - 1), k = Math.floor(f), t = f - k;
  const w = (SPLINE[interp] ?? SPLINE.KEY_BSPLINE)(t);
  return [[k - 1, k, k + 1, k + 2].map((i) => Math.min(n - 1, Math.max(0, i))), w];
}

// The lattice's rest grid, its point displacements this frame and its point group weights.
export function latticeFrame(inst, index) {
  const ob = inst.program.objects[index], d = ob.data;
  const nu = d.points_u ?? 2, nv = d.points_v ?? 2, nw = d.points_w ?? 2;
  const rest = d.points.map((p) => p.co), deformed = inst.latticePoints?.(index) ?? d.points.map((p) => p.co_deform ?? p.co);
  const disp = new Float64Array(rest.length * 3);
  rest.forEach((co, i) => { for (let a = 0; a < 3; a++) disp[i * 3 + a] = deformed[i][a] - co[a]; });
  const at = (u, v, w) => rest[u + nu * (v + nv * w)];
  const range = [[at(0, 0, 0)[0], at(nu - 1, 0, 0)[0]], [at(0, 0, 0)[1], at(0, nv - 1, 0)[1]], [at(0, 0, 0)[2], at(0, 0, nw - 1)[2]]];
  const group = d.vertex_group ? d.vertex_groups?.find((g) => g.name === d.vertex_group)?.weights ?? [] : null;
  return { nu, nv, nw, disp, range, group, interp: [d.interpolation_type_u, d.interpolation_type_v, d.interpolation_type_w] };
}

// The displaced lattice-space point.
export function latticePoint(L, p) {
  const [iu, wu] = axisWeights(L.nu, L.range[0][0], L.range[0][1], p[0], L.interp[0]);
  const [iv, wv] = axisWeights(L.nv, L.range[1][0], L.range[1][1], p[1], L.interp[1]);
  const [iw, ww] = axisWeights(L.nw, L.range[2][0], L.range[2][1], p[2], L.interp[2]);
  let dx = 0, dy = 0, dz = 0, g = 0;
  for (let c = 0; c < iw.length; c++) for (let b = 0; b < iv.length; b++) for (let a = 0; a < iu.length; a++) {
    const w = wu[a] * wv[b] * ww[c];
    if (!w) continue;
    const i = iu[a] + L.nu * (iv[b] + L.nv * iw[c]);
    dx += w * L.disp[i * 3]; dy += w * L.disp[i * 3 + 1]; dz += w * L.disp[i * 3 + 2];
    if (L.group) g += w * (L.group[i] ?? 0);
  }
  const s = L.group ? g : 1;
  return [p[0] + s * dx, p[1] + s * dy, p[2] + s * dz];
}

export function runLattice(inst, mesh, step, cur) {
  const L = latticeFrame(inst, step.lattice);
  const toLat = new Float64Array(16), back = new Float64Array(16);
  mulAffine(toLat, 0, inverseWorld(inst, step.lattice), 0, inst.world, mesh * 16);
  invertAffine(back, 0, toLat, 0);
  const out = new Float64Array(cur.length);
  for (let v = 0; v < cur.length / 3; v++) {
    const o = v * 3, x = cur[o], y = cur[o + 1], z = cur[o + 2];
    const p = [toLat[0] * x + toLat[4] * y + toLat[8] * z + toLat[12], toLat[1] * x + toLat[5] * y + toLat[9] * z + toLat[13], toLat[2] * x + toLat[6] * y + toLat[10] * z + toLat[14]];
    const q = latticePoint(L, p);
    const f = step.strength * (step.mask ? step.mask[v] : 1);
    for (let a = 0; a < 3; a++) {
      const d = back[a] * q[0] + back[4 + a] * q[1] + back[8 + a] * q[2] + back[12 + a];
      out[o + a] = cur[o + a] + f * (d - cur[o + a]);
    }
  }
  return out;
}

function inverseWorld(inst, i) {
  const m = new Float64Array(16);
  invertAffine(m, 0, inst.world, i * 16);
  return m;
}
