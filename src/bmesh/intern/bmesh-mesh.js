// Shims for bmesh/intern/bmesh-mesh.js: export a Blender name here to replace its generated port.
import { BM_VERT, BM_EDGE, BM_LOOP, BM_FACE } from './bmesh-class.js';
import { BM_VERTS_OF_MESH, BM_EDGES_OF_MESH, BM_FACES_OF_MESH, BM_LOOPS_OF_FACE } from './bmesh-query.js';

// Element indices are a pool field; BM_mesh_elem_index_ensure numbers them densely in iteration order, loops
// face by face, as Blender does.
export function BM_mesh_elem_index_ensure(bm, htype) {
  const number = (pool, elems) => elems.forEach((x, i) => { pool.index[x] = i; });
  if (htype & BM_VERT) number(bm.v, BM_VERTS_OF_MESH(bm));
  if (htype & BM_EDGE) number(bm.e, BM_EDGES_OF_MESH(bm));
  if (htype & BM_FACE) number(bm.f, BM_FACES_OF_MESH(bm));
  if (htype & BM_LOOP) number(bm.l, BM_FACES_OF_MESH(bm).flatMap((f) => BM_LOOPS_OF_FACE(bm, f)));
}

// The tables map indices to elements: bm.vtable, bm.etable and bm.ftable.
export function BM_mesh_elem_table_ensure(bm, htype) {
  if (htype & BM_VERT) bm.vtable = BM_VERTS_OF_MESH(bm);
  if (htype & BM_EDGE) bm.etable = BM_EDGES_OF_MESH(bm);
  if (htype & BM_FACE) bm.ftable = BM_FACES_OF_MESH(bm);
}

export const BM_vert_at_index = (bm, index) => bm.vtable[index];
export const BM_face_at_index = (bm, index) => bm.ftable[index];

// The edge whose index (as Mesh conversion numbered them) is `index`, or -1. Works without a table.
export function BM_edge_at_index(bm, index) {
  for (let e = 0; e < bm.e.size; e++) if (bm.e.alive[e] && bm.e.index[e] === index) return e;
  return -1;
}
