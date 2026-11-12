// @ts-nocheck
// SPDX-License-Identifier: MIT OR Apache-2.0
// From babylon-blender-rig (scripts/native-rig.mjs).
// The Hook modifier (specs/hook.md, exact): hooked points follow the hook object or bone through
// M = ObjectWorld^-1 @ HookWorld @ matrix_inverse, out = p + f (M p - p), with f = strength * weight * falloff.
import { mulAffine, invertAffine } from '../rig/m4.js';

const FALLOFF = {
  CONSTANT: () => 1, LINEAR: (t) => t, SMOOTH: (t) => 3 * t * t - 2 * t * t * t,
  SPHERE: (t) => Math.sqrt(2 * t - t * t), ROOT: (t) => Math.sqrt(t), INVERSE_SQUARE: (t) => t * (2 - t), SHARP: (t) => t * t,
};

// matrix_inverse as rows (Blender's Matrix) or flat column-major.
const colMajor = (m) => {
  if (!m) return new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  if (Array.isArray(m[0])) return Float64Array.from({ length: 16 }, (_, i) => m[i % 4][(i / 4) | 0]);
  return Float64Array.from(m);
};

export function bindHook(program, ob, m, geo) {
  const object = program.objectIndex.get(m.object);
  if (object === undefined) return null;
  if (m.falloff_type === 'CURVE' && (m.falloff_radius ?? 0) > 0) return { unsupported: 'Hook with a custom falloff curve' };
  const bone = m.subtarget ? program.objects[object].boneIndex?.get(m.subtarget) ?? -1 : -1;
  // Which points: the listed indices (weighted by the group if any), else every point by the group, else none.
  const n = geo.count, g = m.vertex_group ? geo.groups.get(m.vertex_group) ?? [] : null;
  const weightOf = (v) => (g ? (m.invert_vertex_group ? 1 - (g[v] ?? 0) : g[v] ?? 0) : 1);
  const listed = m.vertex_indices?.length ? Array.from(m.vertex_indices).filter((v) => v < n) : g ? [...Array(n).keys()] : [];
  const points = [], weights = [];
  for (const v of listed) { const w = weightOf(v); if (w) { points.push(v); weights.push(w); } }
  return {
    falloffType: m.falloff_type ?? 'SMOOTH', object, bone, inverse: colMajor(m.matrix_inverse), center: m.center ?? [0, 0, 0], strength: m.strength ?? 1,
    falloff: (m.falloff_radius ?? 0) > 0 && m.falloff_type !== 'NONE' ? FALLOFF[m.falloff_type ?? 'SMOOTH'] ?? FALLOFF.SMOOTH : null, radius: m.falloff_radius ?? 0,
    uniform: !!m.use_falloff_uniform, points: Int32Array.from(points), weights: Float64Array.from(weights),
    M: new Float64Array(16), inv: new Float64Array(16),
  };
}

// The point map this frame, in the hooked object's space.
export function hookMatrix(inst, mesh, step) {
  const { M, inv } = step;
  if (step.bone >= 0) mulAffine(M, 0, inst.world, step.object * 16, inst.pose, step.bone * 16);
  else M.set(inst.world.subarray(step.object * 16, step.object * 16 + 16));
  invertAffine(inv, 0, inst.world, mesh * 16);
  mulAffine(M, 0, inv, 0, M, 0);
  mulAffine(M, 0, M, 0, step.inverse, 0);
  return M;
}

// dst (holding src) gets the hooked points.
export function hookInto(dst, src, step, M) {
  const { points, weights, center: c, falloff, radius, uniform, inverse: I, strength } = step;
  for (let k = 0; k < points.length; k++) {
    const o = points[k] * 3, x = src[o], y = src[o + 1], z = src[o + 2];
    let f = strength * weights[k];
    if (falloff) {
      let dx = x - c[0], dy = y - c[1], dz = z - c[2];
      if (uniform) { const ux = I[0] * dx + I[4] * dy + I[8] * dz, uy = I[1] * dx + I[5] * dy + I[9] * dz; dz = I[2] * dx + I[6] * dy + I[10] * dz; dx = ux; dy = uy; }
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      f *= d >= radius ? 0 : falloff(1 - d / radius);
    }
    if (!f) continue;
    const qx = M[0] * x + M[4] * y + M[8] * z + M[12], qy = M[1] * x + M[5] * y + M[9] * z + M[13], qz = M[2] * x + M[6] * y + M[10] * z + M[14];
    dst[o] = x + f * (qx - x); dst[o + 1] = y + f * (qy - y); dst[o + 2] = z + f * (qz - z);
  }
}

export function runHook(inst, mesh, step, cur) {
  const out = Float64Array.from(cur);
  hookInto(out, cur, step, hookMatrix(inst, mesh, step));
  return out;
}

// The hook as GPU data: per vertex its factor strength * weight (0 for points not hooked), and the falloff as
// (kind, radius, uniform, 0) with kind 0 none, 1 constant, 2 linear, 3 smooth, 4 sphere, 5 root, 6 inverse square,
// 7 sharp; the center and matrix_inverse go with the per-frame matrix.
const KIND = { CONSTANT: 1, LINEAR: 2, SMOOTH: 3, SPHERE: 4, ROOT: 5, INVERSE_SQUARE: 6, SHARP: 7 };
export function hookTables(step, count) {
  const factor = new Float32Array(count);
  step.points.forEach((v, k) => { factor[v] = step.strength * step.weights[k]; });
  const kind = step.falloff ? KIND[step.falloffType] ?? 3 : 0;
  return { factor, falloff: new Float32Array([kind, step.radius, step.uniform ? 1 : 0, 0]) };
}
