// Mesh.from_pydata (bpy_types.py): a Mesh from vertex positions in Blender's axes, edges as vertex index pairs and
// faces as vertex index loops. Faces shade smooth on request, as Mesh.shade_smooth() leaves them.
import { BM_mesh_create, BM_ELEM_SMOOTH } from '../../bmesh/intern/bmesh-class.js';
import { BM_vert_create, BM_edge_create, BM_face_create_verts, BM_CREATE_NOP, BM_CREATE_NO_DOUBLE } from '../../bmesh/intern/bmesh-core.js';
import { BM_mesh_bm_to_me } from '../../bmesh/intern/bmesh-mesh-convert.js';

export function mesh_from_pydata(vertices, edges = [], faces = [], { smooth = false } = {}) {
  const bm = BM_mesh_create();
  const verts = vertices.map((co) => {
    if (co.length !== 3 || !co.every(Number.isFinite)) throw Error('Vertices need three finite coordinates');
    return BM_vert_create(bm, co);
  });
  const vert = (i) => {
    if (!(verts[i] >= 0)) throw Error('No vertex ' + i);
    return verts[i];
  };
  for (const [a, b] of edges) BM_edge_create(bm, vert(a), vert(b), -1, BM_CREATE_NO_DOUBLE);
  for (const loop of faces) {
    const f = BM_face_create_verts(bm, loop.map(vert), loop.length, -1, BM_CREATE_NOP, true);
    if (smooth) bm.f.hflag[f] |= BM_ELEM_SMOOTH;
  }
  return BM_mesh_bm_to_me(bm);
}

// Mesh.shade_smooth() and Mesh.shade_flat(): every face smooth, or every face flat.
export function mesh_shade(mesh, smooth) {
  if (smooth) mesh.attributes.delete('sharp_face');
  else mesh.attributes.set('sharp_face', { domain: 'FACE', type: 'BOOLEAN', data: new Uint8Array(mesh.faces_num).fill(1) });
  mesh.tag_topology_changed();
  return mesh;
}
