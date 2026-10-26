// Mesh to Babylon geometry (draw_cache_impl_mesh.cc, mesh_extractors). Babylon vertices are Blender face corners;
// triangles come from corner_tris. Mesh data is in Blender's axes (Z up, right-handed); this is the one place it
// meets Babylon's (Y up, left-handed): (x, y, z) becomes (x, z, y). Swapping axes also flips handedness, so
// Blender's counter-clockwise faces stay front facing in Babylon with their winding unchanged.
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
import { CreateLineSystem } from '@babylonjs/core/Meshes/Builders/linesBuilder.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';

const babylonPoint = (p, v) => new Vector3(p[v * 3], p[v * 3 + 2], p[v * 3 + 1]);
// Object Mode wire color of Blender's default theme.
const WIRE = Color3.Black();

export function mesh_batch_cache_vertex_data(mesh) {
  const { vert_positions: p, corner_verts, face_offsets } = mesh;
  const corners = mesh.corners_num;
  const positions = new Float32Array(corners * 3), normals = new Float32Array(corners * 3);
  const sharp_face = mesh.attribute('sharp_face');
  const face_normals = mesh.face_normals(), vert_normals = sharp_face?.every(Boolean) ? null : mesh.vert_normals();
  for (let f = 0; f < mesh.faces_num; f++) {
    const flat = !vert_normals || sharp_face?.[f];
    for (let c = face_offsets[f]; c < face_offsets[f + 1]; c++) {
      const v = corner_verts[c] * 3, n = flat ? face_normals.subarray(f * 3, f * 3 + 3) : vert_normals.subarray(v, v + 3);
      positions[c * 3] = p[v]; positions[c * 3 + 1] = p[v + 2]; positions[c * 3 + 2] = p[v + 1];
      normals[c * 3] = n[0]; normals[c * 3 + 1] = n[2]; normals[c * 3 + 2] = n[1];
    }
  }
  const data = new VertexData();
  Object.assign(data, { positions, normals, indices: mesh.corner_tris() });
  const uv = mesh.attribute('UVMap');
  if (uv) data.uvs = uv;
  return data;
}

// Faces become the mesh's geometry; loose edges a line child that picks as its owner.
export function mesh_batch_cache_apply(mesh, babylonMesh) {
  babylonMesh.makeGeometryUnique?.();
  mesh_batch_cache_vertex_data(mesh).applyToMesh(babylonMesh, true);
  // A single submesh would keep its old index count when an edit changes the topology.
  if (babylonMesh.subMeshes?.length <= 1) babylonMesh._createGlobalSubMesh(true);
  babylonMesh.getChildMeshes(true).filter((child) => child.metadata?.drawOwner === babylonMesh).forEach((child) => child.dispose());
  const loose = mesh.loose_edges();
  if (loose.length) {
    const p = mesh.vert_positions, lines = Array.from(loose, (e) => [babylonPoint(p, mesh.edges[e * 2]), babylonPoint(p, mesh.edges[e * 2 + 1])]);
    const wire = CreateLineSystem(babylonMesh.name + ' loose edges', { lines }, babylonMesh.getScene());
    wire.color = WIRE;
    wire.parent = babylonMesh;
    wire.intersectionThreshold = 0.05;
    wire.metadata = { drawOwner: babylonMesh };
  }
  babylonMesh.refreshBoundingInfo();
}
