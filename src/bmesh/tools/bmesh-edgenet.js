// Edge net fill (bmesh_edgenet.cc): finds the shortest closed paths over tagged edges that have at most one face
// and makes faces of them. Blender's linked lists, which prepend and pop at the head, are arrays used as stacks
// (the end is the head); a path list is an array in head-first order.
import { BM_ITER_MESH, BM_ELEM_TAG, BM_elem_flag_test, BM_elem_flag_disable, BM_elem_flag_enable } from '../intern/bmesh-class.js';
import { BM_face_create } from '../intern/bmesh-core.js';
import { BM_EDGES_OF_VERT, BM_FACES_OF_VERT, BM_edge_exists, BM_edge_other_vert } from '../intern/bmesh-query.js';
import { BM_edges_from_verts } from '../intern/bmesh-construct.js';

const VNINFO_FLAG_IS_MIXFACE = 1;

export function BM_mesh_edgenet(bm, use_edge_tag, use_new_face_tag) {
  const { l } = bm;
  const vnet = new Map();
  const vn = (v) => { let info = vnet.get(v); if (!info) vnet.set(v, (info = { prev: -1, pass: 0, face: 0, flag: 0 })); return info; };
  const step_ok = (e) => BM_elem_flag_test(bm.e, e, BM_ELEM_TAG) && (bm.e.l[e] < 0 || l.radial_next[bm.e.l[e]] === bm.e.l[e]);
  const edge_face = (e) => (bm.e.l[e] >= 0 ? l.f[bm.e.l[e]] : -1);

  // Half a loop: the verts back along `prev` while the pass stays the same, prepended to `path`.
  function path_from_pass(v, path) {
    const pass = vn(v).pass;
    let count = 0;
    do {
      path.unshift(v);
      count++;
      v = vn(v).prev;
    } while (vn(v).pass === pass);
    return count;
  }

  // BM_face_exists_overlap_subset: whether an existing face uses only verts of the path through v1 and v2.
  function path_check_overlap(v1, v2) {
    const verts = [];
    for (let v of [v1, v2]) {
      const pass = vn(v).pass;
      do { verts.unshift(v); v = vn(v).prev; } while (vn(v).pass === pass);
    }
    const inPath = new Set(verts);
    return verts.some((v) => BM_FACES_OF_VERT(bm, v).some((f) => {
      if (bm.f.len[f] > verts.length) return false;
      const first = bm.f.l_first[f];
      let it = first;
      do if (!inPath.has(l.v[it])) return false; while ((it = l.next[it]) !== first);
      return true;
    }));
  }

  // Steps from v_curr to the verts not yet on the path; returns the edge closing a loop, or -1.
  function path_step(v_curr, v_ls) {
    for (;;) {
      let tot = 0, v_ls_tot = 0;
      const vn_curr = vn(v_curr);
      for (const e of BM_EDGES_OF_VERT(bm, v_curr)) {
        const v_next = BM_edge_other_vert(bm, e, v_curr);
        if (v_next === vn_curr.prev) continue;
        if (step_ok(e)) {
          const vn_next = vn(v_next);
          if (vn_curr.pass !== vn_next.pass) {
            if (vn_curr.pass === -vn_next.pass) {
              if ((vn_curr.flag & VNINFO_FLAG_IS_MIXFACE || vn_next.flag & VNINFO_FLAG_IS_MIXFACE) && !path_check_overlap(v_curr, v_next)) return e;
            } else {
              vn_next.face = edge_face(e);
              vn_next.pass = vn_curr.pass;
              vn_next.prev = v_curr;
              vn_next.flag &= ~VNINFO_FLAG_IS_MIXFACE;
              if (vn_curr.flag & VNINFO_FLAG_IS_MIXFACE || vn_next.face === -1 || vn_next.face !== vn_curr.face) vn_next.flag |= VNINFO_FLAG_IS_MIXFACE;
              v_ls.push(v_next);
              v_ls_tot++;
            }
          }
        }
        tot++;
      }
      // Walks along wire edge paths without recursing.
      if (v_ls_tot !== 1 || tot !== 1) return -1;
      v_curr = v_ls.pop();
    }
  }

  // The first path from `e` that can make a face, as { path, cost }, or null.
  function path_calc(e, pass_nr, path_cost_max) {
    const f_index = edge_face(e), vn_1 = vn(bm.e.v1[e]), vn_2 = vn(bm.e.v2[e]);
    vn_1.pass = pass_nr;
    vn_2.pass = -pass_nr;
    vn_1.prev = bm.e.v2[e];
    vn_2.prev = bm.e.v1[e];
    vn_1.face = vn_2.face = f_index;
    vn_1.flag = vn_2.flag = f_index === -1 ? VNINFO_FLAG_IS_MIXFACE : 0;
    let v_ls_prev = [bm.e.v1[e], bm.e.v2[e]], v_ls_next = [], cost = 0, found;
    do {
      found = false;
      if (cost >= path_cost_max) return null;
      while (v_ls_prev.length) {
        const old = [v_ls_next.length, v_ls_next.at(-1)];
        const e_found = path_step(v_ls_prev.pop(), v_ls_next);
        if (e_found >= 0) {
          const path = [];
          path_from_pass(bm.e.v1[e_found], path);
          path.reverse();
          path_from_pass(bm.e.v2[e_found], path);
          return { path, cost };
        }
        if (old[0] !== v_ls_next.length || old[1] !== v_ls_next.at(-1)) found = true;
      }
      cost++;
      v_ls_prev = v_ls_next;
      v_ls_next = [];
    } while (found);
    BM_elem_flag_disable(bm.e, e, BM_ELEM_TAG);
    return null;
  }

  // Checks every edge of the path found from `e` for a cheaper path.
  let pass_nr = 1;
  function path_calc_best(e) {
    let best = path_calc(e, pass_nr++, Infinity);
    if (!best || best.cost < 1) return best;
    const verts = best.path;
    for (let i = 0, i_prev = verts.length - 1; i < verts.length; i_prev = i++) {
      const e_other = BM_edge_exists(bm, verts[i], verts[i_prev]);
      if (e_other === e) continue;
      const test = path_calc(e_other, pass_nr++, best.cost);
      if (test) best = test;
    }
    return best;
  }

  if (!use_edge_tag) BM_ITER_MESH(bm.e, (e) => (step_ok(e) ? BM_elem_flag_enable : BM_elem_flag_disable)(bm.e, e, BM_ELEM_TAG));

  const edge_queue = [];
  const edge_get_next = () => {
    while (edge_queue.length) { const e = edge_queue.pop(); if (step_ok(e)) return e; }
    let next = -1;
    BM_ITER_MESH(bm.e, (e) => { if (next < 0 && step_ok(e)) next = e; });
    return next;
  };
  for (let e; (e = edge_get_next()) >= 0;) {
    const best = path_calc_best(e);
    if (!best) continue;
    const f = BM_face_create(bm, best.path, BM_edges_from_verts(bm, best.path), best.path.length);
    const first = bm.f.l_first[f];
    let it = first;
    do if (step_ok(l.e[it])) edge_queue.push(l.e[it]); while ((it = l.next[it]) !== first);
    if (use_new_face_tag) BM_elem_flag_enable(bm.f, f, BM_ELEM_TAG);
  }
}
