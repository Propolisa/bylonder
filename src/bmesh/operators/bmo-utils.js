// Selection region growing (bmo_utils.cc).
import { BM_ITER_MESH, BM_ELEM_HIDDEN, BM_elem_flag_test, BMO_flag_test, BMO_flag_enable } from '../intern/bmesh-class.js';
import { BM_EDGES_OF_VERT, BM_FACES_OF_EDGE, BM_FACES_OF_VERT, BM_edge_other_vert, BM_edge_is_wire } from '../intern/bmesh-query.js';

const SEL_FLAG = 1, SEL_ORIG = 2;
const loopsOf = (bm, f) => { const out = [], first = bm.f.l_first[f]; let l = first; do out.push(l); while ((l = bm.l.next[l]) !== first); return out; };
const hidden = (pool, i) => BM_elem_flag_test(pool, i, BM_ELEM_HIDDEN);

function bmo_face_flag_set_flush(bm, f, oflag) {
  BMO_flag_enable(bm.f, f, oflag);
  for (const l of loopsOf(bm, f)) {
    BMO_flag_enable(bm.e, bm.l.e[l], oflag);
    BMO_flag_enable(bm.v, bm.l.v[l], oflag);
  }
}

function bmo_region_extend_expand(bm, geom, use_faces, use_faces_step) {
  if (!use_faces) {
    for (const v of geom.verts) {
      if (!BM_EDGES_OF_VERT(bm, v).some((e) => !BMO_flag_test(bm.e, e, SEL_ORIG) && !hidden(bm.e, e))) continue;
      const step = (e) => {
        if (BMO_flag_test(bm.e, e, SEL_FLAG) || hidden(bm.e, e)) return;
        BMO_flag_enable(bm.e, e, SEL_FLAG);
        BMO_flag_enable(bm.v, BM_edge_other_vert(bm, e, v), SEL_FLAG);
      };
      if (!use_faces_step) BM_EDGES_OF_VERT(bm, v).forEach(step);
      else {
        for (const f of BM_FACES_OF_VERT(bm, v)) if (!BMO_flag_test(bm.f, f, SEL_FLAG) && !hidden(bm.f, f)) bmo_face_flag_set_flush(bm, f, SEL_FLAG);
        // Wire edges, when stepping over faces.
        BM_EDGES_OF_VERT(bm, v).filter((e) => BM_edge_is_wire(bm, e)).forEach(step);
      }
    }
  } else {
    for (const f of geom.faces) {
      for (const l of loopsOf(bm, f)) {
        const others = use_faces_step ? BM_FACES_OF_VERT(bm, bm.l.v[l]) : BM_FACES_OF_EDGE(bm, bm.l.e[l]);
        for (const f_other of others) if (!BMO_flag_test(bm.f, f_other, SEL_ORIG | SEL_FLAG) && !hidden(bm.f, f_other)) BMO_flag_enable(bm.f, f_other, SEL_FLAG);
      }
    }
  }
}

function bmo_region_extend_contract(bm, geom, use_faces, use_faces_step) {
  if (!use_faces) {
    for (const v of geom.verts) {
      const found = !use_faces_step
        ? BM_EDGES_OF_VERT(bm, v).some((e) => !BMO_flag_test(bm.e, e, SEL_ORIG))
        : BM_FACES_OF_VERT(bm, v).some((f) => !BMO_flag_test(bm.f, f, SEL_ORIG)) ||
          BM_EDGES_OF_VERT(bm, v).some((e) => BM_edge_is_wire(bm, e) && !BMO_flag_test(bm.e, e, SEL_ORIG));
      if (!found) continue;
      BMO_flag_enable(bm.v, v, SEL_FLAG);
      for (const e of BM_EDGES_OF_VERT(bm, v)) BMO_flag_enable(bm.e, e, SEL_FLAG);
    }
  } else {
    for (const f of geom.faces) {
      for (const l of loopsOf(bm, f)) {
        const others = use_faces_step ? BM_FACES_OF_VERT(bm, bm.l.v[l]) : BM_FACES_OF_EDGE(bm, bm.l.e[l]);
        if (others.some((f_other) => !BMO_flag_test(bm.f, f_other, SEL_ORIG))) BMO_flag_enable(bm.f, f, SEL_FLAG);
      }
    }
  }
}

// geom { verts, edges, faces } in; returns geom.out, the elements added (or, contracting, removed).
export function bmo_region_extend_exec(bm, { geom, use_contract = false, use_faces = false, use_face_step = false }) {
  for (const [pool, list] of [[bm.v, geom.verts], [bm.e, geom.edges], [bm.f, geom.faces]]) for (const i of list) BMO_flag_enable(pool, i, SEL_ORIG);
  (use_contract ? bmo_region_extend_contract : bmo_region_extend_expand)(bm, geom, use_faces, use_face_step);
  const out = (pool) => { const list = []; BM_ITER_MESH(pool, (i) => { if (BMO_flag_test(pool, i, SEL_FLAG)) list.push(i); }); return list; };
  return { verts: out(bm.v), edges: out(bm.e), faces: out(bm.f) };
}

export * from './bmo-utils.gen.js';
