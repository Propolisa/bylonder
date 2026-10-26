// Face geometry (bmesh_polygon.cc).
import { bmesh_kernel_loop_reverse } from './bmesh-core.js';

// BM_face_calc_normal (Newell's method) into f->no; returns the face area times two before normalizing.
export function BM_face_normal_update(bm, f) {
  const { l } = bm, co = bm.v.co;
  const first = bm.f.l_first[f];
  let nx = 0, ny = 0, nz = 0, it = first;
  do {
    const a = l.v[it] * 3, b = l.v[l.next[it]] * 3;
    nx += (co[a + 1] - co[b + 1]) * (co[a + 2] + co[b + 2]);
    ny += (co[a + 2] - co[b + 2]) * (co[a] + co[b]);
    nz += (co[a] - co[b]) * (co[a + 1] + co[b + 1]);
  } while ((it = l.next[it]) !== first);
  const len = Math.hypot(nx, ny, nz);
  const s = len ? 1 / len : 0;
  bm.f.no[f * 3] = nx * s;
  bm.f.no[f * 3 + 1] = ny * s;
  bm.f.no[f * 3 + 2] = nz * s;
  return len;
}

export function BM_face_normal_flip(bm, f) {
  bmesh_kernel_loop_reverse(bm, f);
  for (let a = 0; a < 3; a++) bm.f.no[f * 3 + a] = -bm.f.no[f * 3 + a];
}
