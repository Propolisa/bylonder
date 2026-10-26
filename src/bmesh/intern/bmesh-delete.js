// Deleting tool-flagged geometry (bmesh_delete.cc).
import { BM_ITER_MESH, BMO_flag_test, BMO_flag_enable, BMO_flag_disable } from './bmesh-class.js';
import { BM_vert_kill, BM_edge_kill, BM_face_kill } from './bmesh-core.js';

export const DEL_VERTS = 1, DEL_EDGES = 2, DEL_ONLYFACES = 3, DEL_EDGESFACES = 4, DEL_FACES = 5;

const removeTagged = (pool, kill) => (bm, oflag) => BM_ITER_MESH(bm[pool], (i) => { if (BMO_flag_test(bm[pool], i, oflag)) kill(bm, i); });
const bmo_remove_tagged_faces = removeTagged('f', BM_face_kill);
const bmo_remove_tagged_edges = removeTagged('e', BM_edge_kill);
const bmo_remove_tagged_verts = removeTagged('v', BM_vert_kill);
const bmo_remove_tagged_verts_loose = (bm, oflag) => BM_ITER_MESH(bm.v, (v) => { if (BMO_flag_test(bm.v, v, oflag) && bm.v.e[v] < 0) BM_vert_kill(bm, v); });

const faceLoops = (bm, f, fn) => { const first = bm.f.l_first[f]; let l = first; do fn(l); while ((l = bm.l.next[l]) !== first); };

export function BMO_mesh_delete_oflag_context(bm, oflag, type) {
  if (type === DEL_VERTS) bmo_remove_tagged_verts(bm, oflag);
  else if (type === DEL_EDGES) {
    BM_ITER_MESH(bm.e, (e) => { if (BMO_flag_test(bm.e, e, oflag)) { BMO_flag_enable(bm.v, bm.e.v1[e], oflag); BMO_flag_enable(bm.v, bm.e.v2[e], oflag); } });
    bmo_remove_tagged_edges(bm, oflag);
    bmo_remove_tagged_verts_loose(bm, oflag);
  } else if (type === DEL_EDGESFACES) bmo_remove_tagged_edges(bm, oflag);
  else if (type === DEL_ONLYFACES) bmo_remove_tagged_faces(bm, oflag);
  else if (type === DEL_FACES) {
    // Everything the faces use goes, except what the remaining faces and edges still use.
    const mark = (f, set) => faceLoops(bm, f, (l) => { set(bm.e, bm.l.e[l], oflag); set(bm.v, bm.l.v[l], oflag); });
    BM_ITER_MESH(bm.f, (f) => { if (BMO_flag_test(bm.f, f, oflag)) mark(f, BMO_flag_enable); });
    BM_ITER_MESH(bm.f, (f) => { if (!BMO_flag_test(bm.f, f, oflag)) mark(f, BMO_flag_disable); });
    BM_ITER_MESH(bm.e, (e) => { if (!BMO_flag_test(bm.e, e, oflag)) { BMO_flag_disable(bm.v, bm.e.v1[e], oflag); BMO_flag_disable(bm.v, bm.e.v2[e], oflag); } });
    bmo_remove_tagged_faces(bm, oflag);
    bmo_remove_tagged_edges(bm, oflag);
    bmo_remove_tagged_verts(bm, oflag);
  }
}
