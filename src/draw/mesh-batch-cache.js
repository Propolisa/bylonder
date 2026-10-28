// Mesh to Babylon geometry (draw_cache_impl_mesh.cc, mesh_extractors). Babylon vertices are Blender face corners;
// triangles come from corner_tris. Mesh data is in Blender's axes (Z up, right-handed); this is the one place it
// meets Babylon's (Y up, left-handed): (x, y, z) becomes (x, z, y). Swapping axes also flips handedness, so
// Blender's counter-clockwise faces stay front facing in Babylon with their winding unchanged.
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer.js';
import { CreateLineSystem } from '@babylonjs/core/Meshes/Builders/linesBuilder.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { BoundingInfo } from '@babylonjs/core/Culling/boundingInfo.js';
import { mesh_batch_cache_vertex_buffers } from './mesh-batch-buffers.js';

const babylonPoint = (p, v) => new Vector3(p[v * 3], p[v * 3 + 2], p[v * 3 + 1]);
// Object Mode wire color of Blender's default theme.
const WIRE = Color3.Black();

export const mesh_batch_cache_vertex_data = (mesh) => Object.assign(new VertexData(), mesh_batch_cache_vertex_buffers(mesh));

// The bounding box, for the mesh and its one submesh (which picking tests), from the Mesh's own bounds: Babylon's
// refresh reads the vertex buffer back.
function setBounds(mesh, babylonMesh) {
  const bounds = mesh.bounds_min_max();
  if (!bounds || babylonMesh.subMeshes?.length > 1) return babylonMesh.refreshBoundingInfo();
  const corner = ([x, y, z]) => new Vector3(x, z, y), box = () => new BoundingInfo(corner(bounds.min), corner(bounds.max));
  babylonMesh.setBoundingInfo(box());
  babylonMesh.subMeshes?.[0]?.setBoundingInfo(box());
}

// Each object's face edges as pairs of its Babylon vertices (face corners), for Wireframe shading: Blender draws a
// mesh's edges, not the triangles its faces are drawn with.
const faceEdges = new WeakMap();

function face_edge_corners(mesh) {
  const { face_offsets } = mesh, lines = new Uint32Array(mesh.corners_num * 2);
  for (let f = 0; f < mesh.faces_num; f++) {
    const start = face_offsets[f], end = face_offsets[f + 1];
    for (let c = start; c < end; c++) { lines[c * 2] = c; lines[c * 2 + 1] = c + 1 < end ? c + 1 : start; }
  }
  return lines;
}

// The edges Wireframe shading draws for a Babylon mesh as vertex index pairs: its Mesh's face edges, or for geometry
// Babylon built, its triangles' edges.
export function mesh_batch_cache_wire_indices(babylonMesh) {
  if (faceEdges.has(babylonMesh)) return faceEdges.get(babylonMesh);
  const tris = babylonMesh.getIndices() ?? [], lines = new Uint32Array(tris.length * 2);
  for (let t = 0; t < tris.length; t += 3) for (let i = 0; i < 3; i++) { lines[(t + i) * 2] = tris[t + i]; lines[(t + i) * 2 + 1] = tris[t + (i + 1) % 3]; }
  return lines;
}

// Faces become the mesh's geometry; loose edges a line child that picks as its owner. With `topology` false only
// positions changed since the last apply, so the buffers are updated in place.
export function mesh_batch_cache_apply(mesh, babylonMesh, { topology = true } = {}) {
  if (!topology && !mesh.loose_edges().length) {
    const data = mesh_batch_cache_vertex_data(mesh);
    babylonMesh.updateVerticesData(VertexBuffer.PositionKind, data.positions);
    babylonMesh.updateVerticesData(VertexBuffer.NormalKind, data.normals);
    babylonMesh.updateIndices(data.indices);
    setBounds(mesh, babylonMesh);
    return;
  }
  babylonMesh.makeGeometryUnique?.();
  mesh_batch_cache_vertex_data(mesh).applyToMesh(babylonMesh, true);
  faceEdges.set(babylonMesh, face_edge_corners(mesh));
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
  setBounds(mesh, babylonMesh);
}
