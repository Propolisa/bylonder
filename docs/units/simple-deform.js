// SPDX-License-Identifier: MIT OR Apache-2.0
// Provenance: written from Blender's manual and the shipped unit's observed behaviour (unit-oracle.mjs), not from Blender's code.
// Simple Deform (modifier:SIMPLE_DEFORM) as a unit of its own, the worked example of docs/escaping-the-gpl.md: Twist and
// Bend about the object's origin, with limits and a vertex group. Bend ignores the lock axes, as the shipped unit does;
// Taper, Stretch and Twist's locks are not written, and such an entity is reported and stays as last drawn.

const AXES = { X: 0, Y: 1, Z: 2 };

/** The vertices' weights in a vertex group: 0 for a vertex outside it, 1 everywhere without a group. */
function weightsOf(mesh, name, invert, count) {
  const group = name && mesh.vertex_groups?.find((g) => g.name === name);
  const weights = new Float32Array(count).fill(group ? 0 : 1);
  if (group) group.verts.forEach((v, i) => { weights[v] = group.weights[i]; });
  return invert ? weights.map((w) => 1 - w) : weights;
}

/** The deformation of one point in the axis's frame: `a` along the axis, `u` and `v` across it. */
const DEFORM = {
  // Turns each slice across the axis by the angle at its place along it.
  TWIST: ([u, v, a], k, lo, hi) => {
    const t = k * Math.min(hi, Math.max(lo, a)), c = Math.cos(t), s = Math.sin(t);
    return [u * c - v * s, u * s + v * c, a];
  },
  // Lays the line along u onto an arc of radius 1/k about the axis, the part past the limits going on straight.
  BEND: ([u, v, a], k, lo, hi) => {
    if (k === 0) return [u, v, a];
    const clamped = Math.min(hi, Math.max(lo, u)), t = k * clamped, r = 1 / k, c = Math.cos(t), s = Math.sin(t), past = u - clamped;
    return [(r - v) * s + past * c, r - (r - v) * c + past * s, a];
  },
};

export default {
  'modifier:SIMPLE_DEFORM': {
    run({ mesh, angle = 0.785398, deform_method = 'TWIST', deform_axis = 'X', limits = [0, 1], lock_x = false, lock_y = false, lock_z = false, vertex_group = '', invert_vertex_group = false }) {
      const deform = DEFORM[deform_method];
      if (!deform) throw new Error(`Simple Deform: ${deform_method} is not written yet`);
      const axis = AXES[deform_axis], [iu, iv] = [0, 1, 2].filter((i) => i !== axis);
      const positions = mesh.vert_positions, count = positions.length / 3, out = new Float32Array(positions);
      // Twist runs along the axis, Bend along the first axis across it: the limits are its share of the bounds there.
      const along = deform_method === 'BEND' ? iu : axis;
      let min = Infinity, max = -Infinity;
      for (let i = 0; i < count; i++) { min = Math.min(min, positions[i * 3 + along]); max = Math.max(max, positions[i * 3 + along]); }
      const lo = min + (max - min) * limits[0], hi = min + (max - min) * limits[1];
      const k = hi > lo ? angle / (hi - lo) : 0;
      if (deform_method !== 'BEND' && (lock_x || lock_y || lock_z)) throw new Error('Simple Deform: the lock axes are not written yet');
      const weights = weightsOf(mesh, vertex_group, invert_vertex_group, count);
      for (let i = 0; i < count; i++) {
        if (!weights[i]) continue;
        const p = [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]];
        const [u, v, a] = deform([p[iu], p[iv], p[axis]], k, lo, hi), moved = [];
        moved[iu] = u; moved[iv] = v; moved[axis] = a;
        for (let c = 0; c < 3; c++) out[i * 3 + c] = p[c] + (moved[c] - p[c]) * weights[i];
      }
      return { mesh: { ...mesh, vert_positions: out } };
    },
  },
};
