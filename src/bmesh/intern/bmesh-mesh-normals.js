// Face and vertex normals (bmesh_mesh_normals.cc): faces by Newell's method, verts by corner angle weighted faces.
import { BM_ITER_MESH } from './bmesh-class.js';
import { BM_face_normal_update } from './bmesh-polygon.js';
import { bmesh_disk_edge_next } from './bmesh-structure.js';

// safe_acos_approx (BLI_math_base.hh), the acos Blender uses for vertex normal weights.
export function safe_acos_approx(x) {
  const f = Math.abs(x), m = f < 1 ? 1 - (1 - f) : 1;
  const a = Math.sqrt(1 - m) * (1.5707963267 + m * (-0.213300989 + m * (0.077980478 + m * -0.02164095)));
  return x < 0 ? Math.PI - a : a;
}

const edgeDir = (bm, e) => {
  const co = bm.v.co, a = bm.e.v1[e] * 3, b = bm.e.v2[e] * 3;
  const d = [co[a] - co[b], co[a + 1] - co[b + 1], co[a + 2] - co[b + 2]], len = Math.hypot(...d);
  return len ? d.map((x) => x / len) : [0, 0, 0];
};

function bm_vert_calc_normals_accum(bm, v, no) {
  const { l } = bm, e_first = bm.v.e[v];
  if (e_first < 0) return;
  let e = e_first;
  do {
    const l_first = bm.e.l[e];
    if (l_first < 0) continue;
    const e2diff = edgeDir(bm, e);
    let it = l_first;
    do {
      if (l.v[it] !== v) continue;
      const e_prev = l.e[l.prev[it]], e1diff = edgeDir(bm, e_prev);
      let dot = e1diff[0] * e2diff[0] + e1diff[1] * e2diff[1] + e1diff[2] * e2diff[2];
      if ((bm.e.v1[e_prev] === l.v[l.prev[it]]) !== (bm.e.v1[l.e[it]] === l.v[it])) dot = -dot;
      const fac = safe_acos_approx(-dot), f = l.f[it];
      for (let a = 0; a < 3; a++) no[a] += bm.f.no[f * 3 + a] * fac;
    } while ((it = l.radial_next[it]) !== l_first);
  } while ((e = bmesh_disk_edge_next(bm, e, v)) !== e_first);
}

const normalize = (no) => { const len = Math.hypot(...no); if (!len) return false; for (let a = 0; a < 3; a++) no[a] /= len; return true; };

export function BM_mesh_normals_update(bm) {
  BM_ITER_MESH(bm.f, (f) => BM_face_normal_update(bm, f));
  const co = bm.v.co;
  BM_ITER_MESH(bm.v, (v) => {
    const no = [0, 0, 0];
    bm_vert_calc_normals_accum(bm, v, no);
    if (!normalize(no)) {
      let e = bm.v.e[v];
      const first = e;
      if (e >= 0) do {
        const other = bm.e.v1[e] === v ? bm.e.v2[e] : bm.e.v1[e];
        if (co[other * 3] === co[v * 3] && co[other * 3 + 1] === co[v * 3 + 1] && co[other * 3 + 2] === co[v * 3 + 2]) bm_vert_calc_normals_accum(bm, other, no);
      } while ((e = bmesh_disk_edge_next(bm, e, v)) !== first);
      if (!normalize(no)) { no.splice(0, 3, co[v * 3], co[v * 3 + 1], co[v * 3 + 2]); normalize(no); }
    }
    bm.v.no.set(no, v * 3);
  });
}
