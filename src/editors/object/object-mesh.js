import { VertexData } from '@babylonjs/core';
import { primitive_add } from '../mesh/editmesh-add.js';
import { mesh_deserialize } from '../../blenkernel/mesh/mesh.js';
import { mesh_from_vertex_data } from '../../blenkernel/mesh/mesh-from-babylon.js';

// The Mesh an object's geometry comes from: its saved Mesh, its Blender primitive, or its Babylon geometry (by default
// what it draws) welded.
export function objectMesh(node, data) {
  const creation = node.metadata?.wbCreation;
  if (creation?.mesh) return mesh_deserialize(creation.mesh);
  if (creation?.operator) return primitive_add(creation.operator, creation.options);
  return mesh_from_vertex_data(data ?? VertexData.ExtractFromMesh(node));
}
