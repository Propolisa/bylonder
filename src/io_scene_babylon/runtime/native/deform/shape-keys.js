// @ts-nocheck
// SPDX-License-Identifier: MIT OR Apache-2.0
// From babylon-blender-rig (scripts/native-rig.mjs).
// Shape keys (specs/shape_keys.md): Relative keys as sums of deltas, Absolute keys by eval_time. Values come from the
// description's key blocks; inst.shapeKeyValue(mesh, name) overrides a value per instance (animation, drivers).

const SPLINE = {
  KEY_LINEAR: (t) => [0, 1 - t, t, 0],
  KEY_CARDINAL: (t) => cardinal(t, 0.71),
  KEY_CATMULL_ROM: (t) => cardinal(t, 0.5),
  KEY_BSPLINE: (t) => [(1 - t) ** 3 / 6, (3 * t ** 3 - 6 * t ** 2 + 4) / 6, (-3 * t ** 3 + 3 * t ** 2 + 3 * t + 1) / 6, t ** 3 / 6],
};
function cardinal(t, s) {
  return [s * (-(t ** 3) + 2 * t * t - t), (2 - s) * t ** 3 + (s - 3) * t * t + 1, (s - 2) * t ** 3 + (3 - 2 * s) * t * t + s * t, s * (t ** 3 - t * t)];
}

// Relative: per key its value (clamped to the sliders), its vertex group weights and K_k - K_ref.
export function relativeTerms(keys, groups) {
  const byName = new Map(keys.map((k) => [k.name, k]));
  return keys.slice(1).map((k) => {
    const ref = byName.get(k.relative_key) ?? keys[0];
    const delta = new Float64Array(k.co.length);
    for (let i = 0; i < delta.length; i++) delta[i] = k.co[i] - ref.co[i];
    return { key: k, delta, group: k.vertex_group ? groups.get(k.vertex_group) ?? [] : null };
  });
}

export function keyValue(k, override) {
  const v = override ?? k.value ?? 0;
  return Math.min(k.slider_max ?? 1, Math.max(k.slider_min ?? 0, v));
}

// Absolute keys: each key's weight at eval_time (keys at frames 0, 10, 20 ...; four neighbouring keys mixed).
export function absoluteWeights(sk, evalTime) {
  const keys = sk.key_blocks, n = keys.length, w = new Float64Array(n);
  if (n === 1) { w[0] = 1; return w; }
  const frame = Math.min((n - 1) * 10, Math.max(0, evalTime ?? sk.eval_time ?? 0));
  const k = Math.min(Math.floor(frame / 10), n - 2), t = (frame - k * 10) / 10;
  const wa = SPLINE[keys[k].interpolation ?? 'KEY_LINEAR'](t), wb = SPLINE[keys[k + 1].interpolation ?? 'KEY_LINEAR'](t);
  [k - 1, k, k + 1, k + 2].forEach((i, c) => { w[Math.min(n - 1, Math.max(0, i))] += (1 - t) * wa[c] + t * wb[c]; });
  return w;
}

export function applyShapeKeys(inst, deform) {
  const sk = deform.shapeKeys, keys = sk.key_blocks;
  const mesh = inst.program.objects[deform.mesh];
  const out = new Float64Array(keys[0].co.length);
  if (sk.use_relative === false) {
    const w = absoluteWeights(sk, inst.shapeKeyEvalTime?.(deform.mesh));
    for (let j = 0; j < keys.length; j++) {
      if (!w[j]) continue;
      const co = keys[j].co;
      for (let i = 0; i < out.length; i++) out[i] += w[j] * co[i];
    }
    return out;
  }
  deform.relative ??= relativeTerms(keys, new Map((mesh.data.vertex_groups ?? []).map((g) => [g.name, g.weights])));
  out.set(keys[0].co);
  for (const term of deform.relative) {
    if (term.key.mute) continue;
    const value = keyValue(term.key, inst.shapeKeyValue?.(deform.mesh, term.key.name));
    if (!value) continue;
    for (let v = 0; v < out.length / 3; v++) {
      const g = term.group ? term.group[v] ?? 0 : 1;
      if (!g) continue;
      for (let a = 0; a < 3; a++) out[v * 3 + a] += value * g * term.delta[v * 3 + a];
    }
  }
  return out;
}
