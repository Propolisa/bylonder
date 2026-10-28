// A Mesh's draw buffers as typed arrays (mesh-batch-cache.js's geometry): one Babylon vertex per face corner, in
// Babylon's axes, with flat or smooth normals as Blender draws them. Free of Babylon, for the modifier kernels polyfill.
export function mesh_batch_cache_vertex_buffers(mesh) {
  const { vert_positions: p, corner_verts, face_offsets } = mesh;
  const corners = mesh.corners_num;
  const positions = new Float32Array(corners * 3), normals = new Float32Array(corners * 3);
  const sharp_face = mesh.attribute('sharp_face');
  const face_normals = mesh.face_normals(), vert_normals = sharp_face?.every(Boolean) ? null : mesh.vert_normals();
  for (let f = 0; f < mesh.faces_num; f++) {
    const flat = !vert_normals || sharp_face?.[f];
    for (let c = face_offsets[f]; c < face_offsets[f + 1]; c++) {
      const v = corner_verts[c] * 3, n = flat ? face_normals : vert_normals, i = flat ? f * 3 : v;
      positions[c * 3] = p[v]; positions[c * 3 + 1] = p[v + 2]; positions[c * 3 + 2] = p[v + 1];
      normals[c * 3] = n[i]; normals[c * 3 + 1] = n[i + 2]; normals[c * 3 + 2] = n[i + 1];
    }
  }
  const uvs = mesh.attribute('UVMap');
  return { positions, normals, indices: mesh.corner_tris(), ...(uvs && { uvs }) };
}
