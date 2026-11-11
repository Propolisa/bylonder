// @ts-nocheck
// SPDX-License-Identifier: MIT OR Apache-2.0
// From babylon-blender-rig (scripts/native-rig.mjs).
// The Displace modifier without a texture (specs/displace.md): every vertex moves strength * (1 - mid_level) * w
// along its direction.
import { maskWeights } from './weights.js';

const AXIS = { X: 0, Y: 1, Z: 2 };

export function bindDisplace(program, ob, m, geo) {
  if (m.texture) return { unsupported: 'Displace with a texture' };
  return {
    faces: geo.faces, mask: maskWeights(geo, m), direction: m.direction ?? 'NORMAL', global: m.space === 'GLOBAL',
    amount: (m.strength ?? 1) * (1 - (m.mid_level ?? 0.5)),
  };
}

// Vertex normals: face normals (Newell) weighted by the corner angle, summed, normalized.
export function vertexNormals(P, faces) {
  const n = new Float64Array(P.length);
  for (const f of faces) {
    let nx = 0, ny = 0, nz = 0;
    f.forEach((a, i) => {
      const b = f[(i + 1) % f.length];
      nx += (P[a * 3 + 1] - P[b * 3 + 1]) * (P[a * 3 + 2] + P[b * 3 + 2]);
      ny += (P[a * 3 + 2] - P[b * 3 + 2]) * (P[a * 3] + P[b * 3]);
      nz += (P[a * 3] - P[b * 3]) * (P[a * 3 + 1] + P[b * 3 + 1]);
    });
    const l = Math.hypot(nx, ny, nz) || 1;
    f.forEach((v, i) => {
      const p = f[(i + f.length - 1) % f.length], q = f[(i + 1) % f.length];
      const e1 = [P[p * 3] - P[v * 3], P[p * 3 + 1] - P[v * 3 + 1], P[p * 3 + 2] - P[v * 3 + 2]];
      const e2 = [P[q * 3] - P[v * 3], P[q * 3 + 1] - P[v * 3 + 1], P[q * 3 + 2] - P[v * 3 + 2]];
      const c = (e1[0] * e2[0] + e1[1] * e2[1] + e1[2] * e2[2]) / ((Math.hypot(...e1) * Math.hypot(...e2)) || 1);
      const angle = Math.acos(Math.max(-1, Math.min(1, c)));
      n[v * 3] += (angle * nx) / l; n[v * 3 + 1] += (angle * ny) / l; n[v * 3 + 2] += (angle * nz) / l;
    });
  }
  for (let v = 0; v < n.length / 3; v++) {
    const l = Math.hypot(n[v * 3], n[v * 3 + 1], n[v * 3 + 2]) || 1;
    n[v * 3] /= l; n[v * 3 + 1] /= l; n[v * 3 + 2] /= l;
  }
  return n;
}

export function runDisplace(inst, mesh, step, cur) {
  const out = Float64Array.from(cur);
  let dir = null;
  if (step.direction === 'NORMAL') dir = vertexNormals(cur, step.faces);
  else {
    const a = AXIS[step.direction];
    // GLOBAL: the transpose of the object's world 3x3 applied to the world axis (observed; not its inverse).
    const d = step.global ? [0, 1, 2].map((r) => inst.world[mesh * 16 + r * 4 + a]) : [0, 1, 2].map((r) => +(r === a));
    dir = { constant: d };
  }
  for (let v = 0; v < cur.length / 3; v++) {
    const k = step.amount * (step.mask ? step.mask[v] : 1);
    for (let i = 0; i < 3; i++) out[v * 3 + i] += k * (dir.constant ? dir.constant[i] : dir[v * 3 + i]);
  }
  return out;
}
