// @ts-nocheck
// SPDX-License-Identifier: MIT OR Apache-2.0
// From babylon-blender-rig (scripts/native-rig.mjs).
// The Surface Deform modifier from Blender's stored bind (specs/surface_deform.md, exact): each bound vertex is the
// influence-weighted sum of binding points on its target's deformed faces, then mixed into the input by strength
// and the vertex group. The bind itself (which faces, the weights) comes with the data (`bind`); recomputing it from
// rest data is open in the spec.
import { maskWeights } from './weights.js';
import { evaluatedPositions } from './targets.js';

export function bindSurfaceDeform(program, ob, m, geo) {
  const target = program.objectIndex.get(m.target);
  if (target === undefined || program.objects[target].type !== 'MESH') return null;
  const b = m.bind;
  if (!b) return { unsupported: 'Surface Deform without a stored bind' };
  return {
    target, strength: m.strength ?? 1, mask: maskWeights(geo, m),
    vertex: Int32Array.from(b.vertex), offsets: Int32Array.from(b.vertex_offsets), mode: Uint8Array.from(b.mode),
    influence: Float64Array.from(b.influence), distance: Float64Array.from(b.normal_distance),
    // Unused slots hold null or garbage: indices read as 0 (a valid vertex), weights as 0.
    indices: Int32Array.from(b.indices, (i) => i ?? 0), weights: Float64Array.from(b.weights, (w) => (Number.isFinite(w) ? w : 0)),
    matrix: b.matrix ? Float64Array.from(b.matrix) : null,
  };
}

export function runSurfaceDeform(inst, mesh, step, cur) {
  const out = Float64Array.from(cur);
  surfaceDeformInto(out, cur, step, evaluatedPositions(inst, step.target));
  return out;
}

// out (a copy of src) gets the bound vertices: T the target's evaluated positions in its own space.
export function surfaceDeformInto(out, src, step, T) {
  const { vertex, offsets, mode, influence, distance, indices: I, weights: W, mask, strength, matrix: M } = step;
  for (let k = 0; k < vertex.length; k++) {
    let x = 0, y = 0, z = 0;
    for (let b = offsets[k]; b < offsets[k + 1]; b++) {
      const o = b * 4, i0 = I[o] * 3, i1 = I[o + 1] * 3, i2 = I[o + 2] * 3, i3 = I[o + 3] * 3;
      // Face normal (the quad's diagonals) and centroid.
      const ax = T[i2] - T[i0], ay = T[i2 + 1] - T[i0 + 1], az = T[i2 + 2] - T[i0 + 2];
      const bx = T[i3] - T[i1], by = T[i3 + 1] - T[i1 + 1], bz = T[i3 + 2] - T[i1 + 2];
      let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
      const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1, d = distance[b] / l;
      nx *= d; ny *= d; nz *= d;
      const w0 = W[o], w1 = W[o + 1], w2 = W[o + 2];
      let px = w0 * T[i0] + w1 * T[i1], py = w0 * T[i0 + 1] + w1 * T[i1 + 1], pz = w0 * T[i0 + 2] + w1 * T[i1 + 2];
      if (mode[b] === 2) {
        px += w2 * 0.25 * (T[i0] + T[i1] + T[i2] + T[i3]);
        py += w2 * 0.25 * (T[i0 + 1] + T[i1 + 1] + T[i2 + 1] + T[i3 + 1]);
        pz += w2 * 0.25 * (T[i0 + 2] + T[i1 + 2] + T[i2 + 2] + T[i3 + 2]);
      } else {
        px += w2 * T[i2]; py += w2 * T[i2 + 1]; pz += w2 * T[i2 + 2];
        if (mode[b] === 1) { const w3 = W[o + 3]; px += w3 * T[i3]; py += w3 * T[i3 + 1]; pz += w3 * T[i3 + 2]; }
      }
      const f = influence[b];
      x += f * (px + nx); y += f * (py + ny); z += f * (pz + nz);
    }
    if (M) { const tx = M[0] * x + M[4] * y + M[8] * z + M[12], ty = M[1] * x + M[5] * y + M[9] * z + M[13]; z = M[2] * x + M[6] * y + M[10] * z + M[14]; x = tx; y = ty; }
    const v = vertex[k], s = strength * (mask ? mask[v] : 1), o = v * 3;
    out[o] = src[o] + s * (x - src[o]); out[o + 1] = src[o + 1] + s * (y - src[o + 1]); out[o + 2] = src[o + 2] + s * (z - src[o + 2]);
  }
}

// The bind as GPU tables: per mesh vertex (start, end, strength x mask, 0) over its bindings (-1, -1 when unbound),
// and per binding three vec4s: (mode, influence, distance, 0), the 4 indices, the 4 weights.
export function surfaceDeformTables(step, count) {
  const ranges = new Float32Array(count * 4), n = step.mode.length, bindings = new Float32Array(Math.max(1, n) * 12);
  for (let v = 0; v < count; v++) { ranges[v * 4] = -1; ranges[v * 4 + 1] = -1; }
  step.vertex.forEach((v, k) => {
    ranges[v * 4] = step.offsets[k]; ranges[v * 4 + 1] = step.offsets[k + 1];
    ranges[v * 4 + 2] = step.strength * (step.mask ? step.mask[v] : 1);
  });
  for (let b = 0; b < n; b++) {
    const o = b * 12;
    bindings[o] = step.mode[b]; bindings[o + 1] = step.influence[b]; bindings[o + 2] = step.distance[b];
    for (let i = 0; i < 4; i++) { bindings[o + 4 + i] = step.indices[b * 4 + i]; bindings[o + 8 + i] = step.weights[b * 4 + i]; }
  }
  return { ranges, bindings, matrix: Float32Array.from(step.matrix ?? [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]) };
}
