// Mesh (DNA_mesh_types.h, BKE_mesh.hh): struct-of-arrays geometry in Blender's axes and element order.
// Derived data is computed on first use and cached until a tag_*_changed call.
import { corner_tris_calc } from './mesh-tessellate.js';
import { mesh_face_normals_calc, mesh_vert_normals_calc } from './mesh-normals.js';

export const ATTR_DOMAIN = { POINT: 'POINT', EDGE: 'EDGE', FACE: 'FACE', CORNER: 'CORNER' };

export function createMesh({ vert_positions, edges, face_offsets, corner_verts, corner_edges, attributes = {} }) {
  let cache = {};
  const mesh = {
    vert_positions, edges, face_offsets, corner_verts, corner_edges,
    // Generic attributes by name: { domain, type, data }. UV maps are FLOAT2 corner attributes.
    attributes: new Map(Object.entries(attributes)),
    get verts_num() { return mesh.vert_positions.length / 3; },
    get edges_num() { return mesh.edges.length / 2; },
    get faces_num() { return mesh.face_offsets.length - 1; },
    get corners_num() { return mesh.corner_verts.length; },
    face_size: (f) => mesh.face_offsets[f + 1] - mesh.face_offsets[f],
    attribute: (name) => mesh.attributes.get(name)?.data,
    // Corner indices, three per triangle, in face order.
    corner_tris() {
      if (cache.corner_tris) return cache.corner_tris;
      const tris = new Int32Array((mesh.corners_num - 2 * mesh.faces_num) * 3);
      corner_tris_calc(mesh.vert_positions, mesh.face_offsets, mesh.corner_verts, tris);
      return (cache.corner_tris = tris);
    },
    // The face of each corner triangle.
    corner_tri_faces() {
      if (cache.corner_tri_faces) return cache.corner_tri_faces;
      const out = new Int32Array(mesh.corners_num - 2 * mesh.faces_num);
      for (let f = 0, t = 0; f < mesh.faces_num; f++) for (let i = 2; i < mesh.face_size(f); i++) out[t++] = f;
      return (cache.corner_tri_faces = out);
    },
    face_normals: () => (cache.face_normals ??= mesh_face_normals_calc(mesh)),
    vert_normals: () => (cache.vert_normals ??= mesh_vert_normals_calc(mesh, mesh.face_normals())),
    // Edges no face uses, as indices.
    loose_edges() {
      if (cache.loose_edges) return cache.loose_edges;
      const used = new Uint8Array(mesh.edges_num);
      for (const e of mesh.corner_edges) used[e] = 1;
      return (cache.loose_edges = Uint32Array.from({ length: mesh.edges_num }, (_, e) => e).filter((e) => !used[e]));
    },
    bounds_min_max() {
      if (cache.bounds) return cache.bounds;
      const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity], p = mesh.vert_positions;
      for (let i = 0; i < p.length; i += 3) for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a], p[i + a]); max[a] = Math.max(max[a], p[i + a]); }
      return (cache.bounds = mesh.verts_num ? { min, max } : null);
    },
    tag_positions_changed() { cache = { corner_tri_faces: cache.corner_tri_faces }; },
    tag_topology_changed() { cache = {}; },
  };
  return mesh;
}

const TYPED = { vert_positions: Float32Array, edges: Int32Array, face_offsets: Int32Array, corner_verts: Int32Array, corner_edges: Int32Array };
const ATTRIBUTE_TYPED = { FLOAT: Float32Array, FLOAT2: Float32Array, INT: Int32Array, BOOLEAN: Uint8Array };

// Plain JSON for scene edits and undo steps.
export function mesh_serialize(mesh) {
  return {
    ...Object.fromEntries(Object.keys(TYPED).map((key) => [key, Array.from(mesh[key])])),
    attributes: Object.fromEntries([...mesh.attributes].map(([name, { domain, type, data }]) => [name, { domain, type, data: Array.from(data) }])),
  };
}

export function mesh_deserialize(json) {
  return createMesh({
    ...Object.fromEntries(Object.entries(TYPED).map(([key, Type]) => [key, Type.from(json[key])])),
    attributes: Object.fromEntries(Object.entries(json.attributes ?? {}).map(([name, { domain, type, data }]) => [name, { domain, type, data: ATTRIBUTE_TYPED[type].from(data) }])),
  });
}
