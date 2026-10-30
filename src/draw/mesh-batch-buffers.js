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
  // Copies, as Babylon keeps them: a Mesh's arrays can be views of the module's memory, which growing it detaches.
  const uvs = mesh.attribute('UVMap');
  return { positions, normals, ...trianglesBySlot(mesh), ...(uvs && { uvs: Float32Array.from(uvs) }) };
}

// The triangles' corners, and with faces of several material slots (material_index), grouped by slot: { slot, start,
// count } of indices for each, as Blender's draw cache batches a mesh per material.
function trianglesBySlot(mesh) {
  const tris = mesh.corner_tris(), slots = mesh.attribute('material_index');
  if (!slots?.some(Boolean)) return { indices: Uint32Array.from(tris) };
  const tri_faces = mesh.corner_tri_faces(), count = tri_faces.length, order = Array.from({ length: count }, (_, i) => i);
  order.sort((a, b) => slots[tri_faces[a]] - slots[tri_faces[b]] || a - b);
  const indices = new Uint32Array(count * 3), groups = [];
  order.forEach((tri, i) => {
    indices.set(tris.subarray(tri * 3, tri * 3 + 3), i * 3);
    const slot = slots[tri_faces[tri]];
    if (groups.at(-1)?.slot !== slot) groups.push({ slot, start: i * 3, count: 0 });
    groups.at(-1).count += 3;
  });
  return { indices, groups };
}
