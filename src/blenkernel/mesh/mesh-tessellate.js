// Triangulation of faces into corner triangles (mesh_tessellate.cc).

// is_quad_flip_v3_first_third_fast (math_geom.cc).
function is_quad_flip(p, v1, v2, v3, v4) {
  const d12 = [p[v2] - p[v1], p[v2 + 1] - p[v1 + 1], p[v2 + 2] - p[v1 + 2]];
  const d13 = [p[v3] - p[v1], p[v3 + 1] - p[v1 + 1], p[v3 + 2] - p[v1 + 2]];
  const d14 = [p[v4] - p[v1], p[v4 + 1] - p[v1 + 1], p[v4 + 2] - p[v1 + 2]];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const a = cross(d12, d13), b = cross(d14, d13);
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] > 0;
}

// Corner indices, three per triangle, in face order.
export function mesh_corner_tris_calc(mesh) {
  const { vert_positions: p, face_offsets, corner_verts } = mesh;
  const tris = new Uint32Array((mesh.corners_num - 2 * mesh.faces_num) * 3);
  let t = 0;
  for (let f = 0; f < mesh.faces_num; f++) {
    const s = face_offsets[f], size = face_offsets[f + 1] - s;
    if (size === 4 && is_quad_flip(p, corner_verts[s] * 3, corner_verts[s + 1] * 3, corner_verts[s + 2] * 3, corner_verts[s + 3] * 3)) {
      tris.set([s, s + 1, s + 3, s + 1, s + 2, s + 3], t);
      t += 6;
      continue;
    }
    // Fan triangulation: exact for triangles and quads; n-gons wait for the BLI_polyfill_2d port.
    for (let i = 1; i < size - 1; i++) { tris[t++] = s; tris[t++] = s + i; tris[t++] = s + i + 1; }
  }
  return tris;
}
