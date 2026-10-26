// Face and vertex normals (mesh_normals.cc).

export function mesh_face_normals_calc(mesh) {
  const { vert_positions: p, face_offsets, corner_verts } = mesh;
  const out = new Float32Array(mesh.faces_num * 3);
  for (let f = 0; f < mesh.faces_num; f++) {
    const start = face_offsets[f], end = face_offsets[f + 1];
    let nx = 0, ny = 0, nz = 0, prev = corner_verts[end - 1] * 3;
    for (let c = start; c < end; c++) {
      const cur = corner_verts[c] * 3;
      nx += (p[prev + 1] - p[cur + 1]) * (p[prev + 2] + p[cur + 2]);
      ny += (p[prev + 2] - p[cur + 2]) * (p[prev] + p[cur]);
      nz += (p[prev] - p[cur]) * (p[prev + 1] + p[cur + 1]);
      prev = cur;
    }
    const len = Math.hypot(nx, ny, nz);
    if (len) { out[f * 3] = nx / len; out[f * 3 + 1] = ny / len; out[f * 3 + 2] = nz / len; }
    else out[f * 3 + 2] = 1;
  }
  return out;
}

// Vertex normals weighted by the corner angle of each face, as Blender does.
export function mesh_vert_normals_calc(mesh, face_normals) {
  const { vert_positions: p, face_offsets, corner_verts } = mesh;
  const out = new Float32Array(mesh.verts_num * 3);
  const dir = (a, b) => { const x = p[b] - p[a], y = p[b + 1] - p[a + 1], z = p[b + 2] - p[a + 2], l = Math.hypot(x, y, z) || 1; return [x / l, y / l, z / l]; };
  for (let f = 0; f < mesh.faces_num; f++) {
    const start = face_offsets[f], size = face_offsets[f + 1] - start;
    for (let i = 0; i < size; i++) {
      const v = corner_verts[start + i] * 3;
      const prev = corner_verts[start + ((i + size - 1) % size)] * 3, next = corner_verts[start + ((i + 1) % size)] * 3;
      const a = dir(v, prev), b = dir(v, next);
      const angle = Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])));
      for (let k = 0; k < 3; k++) out[v + k] += face_normals[f * 3 + k] * angle;
    }
  }
  for (let v = 0; v < out.length; v += 3) {
    const l = Math.hypot(out[v], out[v + 1], out[v + 2]);
    if (l) { out[v] /= l; out[v + 1] /= l; out[v + 2] /= l; }
  }
  return out;
}
