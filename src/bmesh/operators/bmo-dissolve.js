// Dissolve operators (bmo_dissolve.cc).
import { BM_ITER_MESH, BMO_flag_test, BMO_flag_enable, BMO_flag_disable } from '../intern/bmesh-class.js';
import { BM_faces_join, BM_face_kill } from '../intern/bmesh-core.js';
import { BMW_island } from '../intern/bmesh-walkers.js';

const FACE_MARK = 1 << 1, FACE_ORIG = 1 << 2, FACE_NEW = 1 << 3, FACE_TAG = 1 << 4;

// dissolve_faces: joins each manifold region of `faces` into one face. Returns region.out. Run through BMO_op_callf.
export function bmo_dissolve_faces_exec(bm, faces) {
  for (const f of faces) BMO_flag_enable(bm.f, f, FACE_MARK | FACE_TAG);
  const regions = [];
  for (const f of faces) {
    if (!BMO_flag_test(bm.f, f, FACE_TAG)) continue;
    const region = BMW_island(bm, f, FACE_MARK, true);
    if (region.length < 2) continue;
    for (const face of region) {
      BMO_flag_disable(bm.f, face, FACE_TAG);
      BMO_flag_enable(bm.f, face, FACE_ORIG);
    }
    regions.push(region);
  }
  for (const region of regions) {
    let [f_new, f_double] = BM_faces_join(bm, region, true, true);
    if (f_new >= 0) {
      if (f_double >= 0) {
        BM_face_kill(bm, f_new);
        f_new = f_double;
      }
      BMO_flag_disable(bm.f, f_new, FACE_ORIG);
      BMO_flag_enable(bm.f, f_new, FACE_NEW);
    } else {
      for (const face of region) BMO_flag_disable(bm.f, face, FACE_ORIG);
    }
  }
  const region_out = [];
  BM_ITER_MESH(bm.f, (f) => BMO_flag_test(bm.f, f, FACE_NEW) && region_out.push(f));
  return region_out;
}
