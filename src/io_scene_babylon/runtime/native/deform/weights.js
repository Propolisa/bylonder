// @ts-nocheck
// SPDX-License-Identifier: MIT OR Apache-2.0
// From babylon-blender-rig (scripts/native-rig.mjs).
// A modifier's per-vertex mask from its vertex_group (inverted when set): null without a group (all 1).
export function maskWeights(geo, m) {
  if (!m.vertex_group) return null;
  const w = geo.groups.get(m.vertex_group) ?? [];
  const n = geo.count;
  return Float64Array.from({ length: n }, (_, v) => (m.invert_vertex_group ? 1 - (w[v] ?? 0) : w[v] ?? 0));
}
