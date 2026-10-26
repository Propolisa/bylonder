// Making faces from a selection (bmo_create.cc, bmo_edgenet.cc, bmo_fill_edgeloop.cc, bmo_fill_attribute.cc and
// bmo_normals.cc): contextual_create and the operators it tries in turn.
import { BM_ITER_MESH, BM_EDGE, BM_FACE, BM_ELEM_TAG, BM_ELEM_SMOOTH, BM_elem_flag_test, BM_elem_flag_enable, BM_elem_flag_disable, BMO_flag_test, BMO_flag_enable, BMO_flag_disable } from '../intern/bmesh-class.js';
import { BM_edge_create, BM_elem_attrs_copy, BM_CREATE_NO_DOUBLE, BM_CREATE_NOP } from '../intern/bmesh-core.js';
import { BM_face_create_ngon_verts, BM_verts_sort_radial_plane, BM_face_copy_shared } from '../intern/bmesh-construct.js';
import { BM_EDGES_OF_VERT, BM_edge_exists, BM_edge_other_vert, BM_vert_in_edge, BM_edge_share_vert_check, BM_edge_is_manifold, BM_face_exists } from '../intern/bmesh-query.js';
import { BM_face_normal_update, BM_face_normal_flip, BM_face_calc_area, BM_face_calc_center_median_weighted } from '../intern/bmesh-polygon.js';
import { BM_mesh_elem_hflag_disable_all } from '../intern/bmesh-marking.js';
import { BMO_op_callf } from '../intern/bmesh-operators.js';
import { BM_mesh_edgenet } from '../tools/bmesh-edgenet.js';
import { bmo_dissolve_faces_exec } from './bmo-dissolve.js';
import { add_v3, sub_v3, mul_v3_fl, dot_v3, cross_v3, len_squared_v3, normalize_v3, normal_tri_v3 } from '../../blenlib/math-geom.js';

const loopsOf = (bm, f) => { const out = [], first = bm.f.l_first[f]; let l = first; do out.push(l); while ((l = bm.l.next[l]) !== first); return out; };
const co = (bm, v) => [bm.v.co[v * 3], bm.v.co[v * 3 + 1], bm.v.co[v * 3 + 2]];
const flaggedEdgesOf = (bm, v, flag) => BM_EDGES_OF_VERT(bm, v).filter((e) => BMO_flag_test(bm.e, e, flag)).length;
const facesWith = (bm, test) => { const out = []; BM_ITER_MESH(bm.f, (f) => { if (test(f)) out.push(f); }); return out; };

// face_attribute_fill: faces take their data and winding from untagged neighbours, flooding outwards. Returns the
// faces it could not reach.
function bmo_face_attribute_fill_exec(bm, faces, { use_normals = true, use_data = true } = {}) {
  const { l } = bm, tagged = (f) => BM_elem_flag_test(bm.f, f, BM_ELEM_TAG);
  BM_mesh_elem_hflag_disable_all(bm, BM_FACE, BM_ELEM_TAG);
  for (const f of faces) BM_elem_flag_enable(bm.f, f, BM_ELEM_TAG);
  const all_radial_tag = (lp) => { let it = l.radial_next[lp]; do if (!tagged(l.f[it])) return false; while ((it = l.radial_next[it]) !== lp); return true; };
  let queue_prev = [];
  BM_ITER_MESH(bm.f, (f) => { if (tagged(f)) for (const lp of loopsOf(bm, f)) if (!all_radial_tag(lp)) queue_prev.push(lp); });
  while (queue_prev.length) {
    const queue_next = [];
    while (queue_prev.length) {
      const lp = queue_prev.pop(), f = l.f[lp];
      if (!tagged(f)) continue;
      BM_elem_flag_disable(bm.f, f, BM_ELEM_TAG);
      for (let it = l.next[lp]; it !== lp; it = l.next[it]) {
        for (let r = l.radial_next[it]; r !== it; r = l.radial_next[r]) if (tagged(l.f[r])) queue_next.push(r);
      }
      // Copied last, because of the flip.
      let other = l.radial_next[lp];
      while (tagged(l.f[other])) other = l.radial_next[other];
      if (use_data) {
        BM_elem_attrs_copy(bm.f, l.f[other], f);
        BM_face_copy_shared(bm, f, (src) => !tagged(l.f[src]));
      }
      if (use_normals && l.v[lp] === l.v[other]) BM_face_normal_flip(bm, f);
    }
    queue_prev = queue_next;
  }
  return faces.filter(tagged);
}

// recalc_face_normals_find_index: the face whose outermost corner decides the group's winding, and whether it
// points inwards.
function recalc_face_normals_find_index(bm, faces) {
  const { l } = bm, eps = 1.1920929e-7;
  let cent = [0, 0, 0], area_accum = 0;
  for (const f of faces) {
    const area = BM_face_calc_area(bm, f);
    cent = add_v3(cent, mul_v3_fl(BM_face_calc_center_median_weighted(bm, f), area / faces.length));
    area_accum += area;
  }
  if (area_accum) cent = mul_v3_fl(cent, 1 / area_accum);
  const best = { dist_sq: eps, edge_dot: -Infinity, loop_dot: -Infinity };
  let f_start_index = 0, is_flip = false;
  faces.forEach((f, i) => {
    for (const lp of loopsOf(bm, f)) {
      let dir = sub_v3(co(bm, l.v[lp]), cent);
      const dist_sq = len_squared_v3(dir), is_best_dist_sq = dist_sq > best.dist_sq;
      if (!is_best_dist_sq && dist_sq !== best.dist_sq) continue;
      dir = mul_v3_fl(dir, 1 / Math.sqrt(dist_sq));
      const e0 = sub_v3(co(bm, l.v[l.next[lp]]), co(bm, l.v[lp])), e1 = sub_v3(co(bm, l.v[l.prev[lp]]), co(bm, l.v[lp]));
      if (len_squared_v3(e0) <= eps * eps || len_squared_v3(e1) <= eps * eps) continue;
      const d0 = normalize_v3(e0), d1 = normalize_v3(e1);
      const edge_dot = Math.max(dot_v3(dir, d0), dot_v3(dir, d1)), is_best_edge_dot = edge_dot > best.edge_dot;
      if (!is_best_dist_sq && !is_best_edge_dot && edge_dot !== best.edge_dot) continue;
      let loop_dir = cross_v3(d0, d1);
      if (len_squared_v3(loop_dir) <= eps * eps) continue;
      loop_dir = normalize_v3(loop_dir);
      if (dot_v3(loop_dir, [...bm.f.no.subarray(f * 3, f * 3 + 3)]) < 0) loop_dir = mul_v3_fl(loop_dir, -1);
      const loop_dir_dot = dot_v3(dir, loop_dir), loop_dot = Math.abs(loop_dir_dot);
      if (is_best_dist_sq || is_best_edge_dot || loop_dot > best.loop_dot) {
        Object.assign(best, { dist_sq, edge_dot, loop_dot });
        f_start_index = i;
        is_flip = loop_dir_dot < 0;
      }
    }
  });
  return [f_start_index, is_flip];
}

// recalc_face_normals: each group of faces joined by manifold edges gets the outward winding of its outermost face.
function bmo_recalc_face_normals_exec(bm, faces) {
  const { l } = bm, FACE_FLAG = 1, FACE_FLIP = 2, FACE_TEMP = 4;
  const manifold = (lp) => BM_edge_is_manifold(bm, l.e[lp]);
  for (const f of faces) BMO_flag_enable(bm.f, f, FACE_FLAG);
  for (const group of BM_mesh_calc_face_groups(bm, manifold)) {
    if (!group.some((f) => BMO_flag_test(bm.f, f, FACE_FLAG))) continue;
    const [start, is_flip] = recalc_face_normals_find_index(bm, group);
    if (is_flip) BMO_flag_enable(bm.f, group[start], FACE_FLIP);
    const stack = [group[start]];
    BMO_flag_enable(bm.f, group[start], FACE_TEMP);
    while (stack.length) {
      const f = stack.pop(), flip_state = BMO_flag_test(bm.f, f, FACE_FLIP);
      for (const lp of loopsOf(bm, f)) {
        const other = l.radial_next[lp];
        if (other === lp || !manifold(lp) || BMO_flag_test(bm.f, l.f[other], FACE_TEMP)) continue;
        BMO_flag_enable(bm.f, l.f[other], FACE_TEMP);
        ((l.v[other] === l.v[lp]) !== flip_state ? BMO_flag_enable : BMO_flag_disable)(bm.f, l.f[other], FACE_FLIP);
        stack.push(l.f[other]);
      }
    }
    for (const f of group) {
      if (BMO_flag_test(bm.f, f, FACE_FLAG) && BMO_flag_test(bm.f, f, FACE_FLIP)) BM_face_normal_flip(bm, f);
      BMO_flag_disable(bm.f, f, FACE_TEMP);
    }
  }
}

// BM_mesh_calc_face_groups over edges that pass `filter(loop)`: arrays of faces, in walk order.
function BM_mesh_calc_face_groups(bm, filter) {
  const { l } = bm, seen = new Set(), groups = [];
  BM_ITER_MESH(bm.f, (f_start) => {
    if (seen.has(f_start)) return;
    seen.add(f_start);
    const group = [], stack = [f_start];
    while (stack.length) {
      const f = stack.pop();
      group.push(f);
      for (const lp of loopsOf(bm, f)) {
        if (l.radial_next[lp] === lp || !filter(lp)) continue;
        for (let r = l.radial_next[lp]; r !== lp; r = l.radial_next[r]) if (!seen.has(l.f[r])) { seen.add(l.f[r]); stack.push(l.f[r]); }
      }
    }
    groups.push(group);
  });
  return groups;
}

// edgenet_fill: faces over the marked edges, with data, winding and material from their neighbours.
function bmo_edgenet_fill_exec(bm, edges, { mat_nr = 0, use_smooth = false } = {}) {
  if (!bm.totvert || !bm.totedge) return [];
  BM_mesh_elem_hflag_disable_all(bm, BM_EDGE, BM_ELEM_TAG);
  for (const e of edges) BM_elem_flag_enable(bm.e, e, BM_ELEM_TAG);
  BM_mesh_elem_hflag_disable_all(bm, BM_FACE, BM_ELEM_TAG);
  BM_mesh_edgenet(bm, true, true);
  const faces = facesWith(bm, (f) => BM_elem_flag_test(bm.f, f, BM_ELEM_TAG));
  for (const f of faces) {
    bm.f.mat_nr[f] = mat_nr;
    if (use_smooth) BM_elem_flag_enable(bm.f, f, BM_ELEM_SMOOTH);
    BM_face_normal_update(bm, f);
  }
  const failed = bmo_face_attribute_fill_exec(bm, faces);
  if (failed.length) BMO_op_callf(bm, bmo_recalc_face_normals_exec, failed);
  return faces;
}

// edgenet_prepare: joins the ends of one or two open chains of edges, so edgenet_fill can close them.
function bmo_edgenet_prepare_exec(bm, edges) {
  const EDGE_MARK = 1, EDGE_VIS = 2, ELE_NEW = 1;
  for (const e of edges) BMO_flag_enable(bm.e, e, EDGE_MARK);
  if (edges.some((e) => [bm.e.v1[e], bm.e.v2[e]].some((v) => flaggedEdgesOf(bm, v, EDGE_MARK) > 2))) return [];
  const edge_next = (e) => {
    for (const v of [bm.e.v1[e], bm.e.v2[e]]) for (const e2 of BM_EDGES_OF_VERT(bm, v)) if (BMO_flag_test(bm.e, e2, EDGE_MARK) && !BMO_flag_test(bm.e, e2, EDGE_VIS) && e2 !== e) return e2;
    return -1;
  };
  const chains = [];
  while (chains.length < 2) {
    let e = edges.find((e) => !BMO_flag_test(bm.e, e, EDGE_VIS) && (flaggedEdgesOf(bm, bm.e.v1[e], EDGE_MARK) === 1 || flaggedEdgesOf(bm, bm.e.v2[e], EDGE_MARK) === 1)) ?? -1;
    if (e < 0) break;
    const chain = [];
    for (; e >= 0; e = edge_next(e)) { BMO_flag_enable(bm.e, e, EDGE_VIS); chain.push(e); }
    chains.push(chain);
  }
  const closed = (chain) => chain.length > 2 && BM_edge_share_vert_check(bm, chain[0], chain.at(-1));
  let [edges1 = [], edges2 = []] = chains;
  if (closed(edges1)) {
    if (closed(edges2)) return [];
    edges1 = edges2;
    edges2 = [];
  }
  if (closed(edges2)) edges2 = [];
  // The free ends of a chain: the verts of its first and last edges not shared with their neighbours.
  const ends = (chain) => {
    if (chain.length === 1) return [bm.e.v1[chain[0]], bm.e.v2[chain[0]]];
    const i = chain.length - 1, end = (e, n) => (BM_vert_in_edge(bm, n, bm.e.v1[e]) ? bm.e.v2[e] : bm.e.v1[e]);
    return [end(chain[0], chain[1]), end(chain[i], chain[i - 1])];
  };
  const created = [];
  const create = (a, b) => { const e = BM_edge_create(bm, a, b, -1, BM_CREATE_NO_DOUBLE); BMO_flag_enable(bm.e, e, ELE_NEW); created.push(e); };
  if (edges1.length && edges2.length) {
    let [v1, v2] = ends(edges1), [v3, v4] = ends(edges2);
    // The most planar pair of triangles avoids a bow tie quad.
    const dot_24 = dot_v3(normal_tri_v3(co(bm, v1), co(bm, v2), co(bm, v4)), normal_tri_v3(co(bm, v1), co(bm, v4), co(bm, v3)));
    const dot_13 = dot_v3(normal_tri_v3(co(bm, v1), co(bm, v2), co(bm, v3)), normal_tri_v3(co(bm, v1), co(bm, v3), co(bm, v4)));
    if (dot_24 < dot_13) [v3, v4] = [v4, v3];
    create(v1, v3);
    create(v2, v4);
  } else if (edges1.length > 1) create(...ends(edges1));
  const out = [];
  BM_ITER_MESH(bm.e, (e) => { if (BMO_flag_test(bm.e, e, ELE_NEW)) out.push(e); });
  return out;
}

// edgeloop_fill: a face for each closed loop of the edges.
function bmo_edgeloop_fill_exec(bm, edges, { mat_nr = 0, use_smooth = false } = {}) {
  const VERT_USED = 1, EDGE_MARK = 2, ELE_OUT = 4, verts = [];
  for (const e of edges) {
    BMO_flag_enable(bm.e, e, EDGE_MARK);
    for (const v of [bm.e.v1[e], bm.e.v2[e]]) {
      if (BMO_flag_test(bm.v, v, VERT_USED)) continue;
      if (verts.length === edges.length) return [];
      BMO_flag_enable(bm.v, v, VERT_USED);
      verts.push(v);
    }
  }
  if (verts.length !== edges.length || verts.some((v) => flaggedEdgesOf(bm, v, EDGE_MARK) !== 2)) return [];
  let used = 0, e_prev = -1;
  while (used < verts.length) {
    let v = verts.find((v) => BMO_flag_test(bm.v, v, VERT_USED));
    const f_verts = [];
    do {
      const e_next = BM_EDGES_OF_VERT(bm, v).find((e) => BMO_flag_test(bm.e, e, EDGE_MARK) && e !== e_prev);
      f_verts.push(v);
      BMO_flag_disable(bm.v, v, VERT_USED);
      used++;
      v = BM_edge_other_vert(bm, e_next, v);
      e_prev = e_next;
    } while (v !== f_verts[0]);
    if (BM_face_exists(bm, f_verts) < 0) {
      const f = BM_face_create_ngon_verts(bm, f_verts, -1, BM_CREATE_NOP, true, false);
      BMO_flag_enable(bm.f, f, ELE_OUT);
      bm.f.mat_nr[f] = mat_nr;
      if (use_smooth) BM_elem_flag_enable(bm.f, f, BM_ELEM_SMOOTH);
    }
  }
  return facesWith(bm, (f) => BMO_flag_test(bm.f, f, ELE_OUT));
}

// contextual_create: an edge from two verts, faces over edge nets, a dissolve of several faces, faces over loops,
// or a face through a cloud of verts. Returns { edges, faces } made.
export function bmo_contextual_create_exec(bm, { geom, mat_nr = 0, use_smooth = false }) {
  const ELE_NEW = 1, ELE_OUT = 2;
  for (const v of geom.verts) BMO_flag_enable(bm.v, v, ELE_NEW);
  for (const e of geom.edges) BMO_flag_enable(bm.e, e, ELE_NEW);
  for (const f of geom.faces) BMO_flag_enable(bm.f, f, ELE_NEW);
  const totv = geom.verts.length, totf = geom.faces.length;
  let tote = geom.edges.length;
  const marked = () => { const out = []; BM_ITER_MESH(bm.e, (e) => { if (BMO_flag_test(bm.e, e, ELE_NEW)) out.push(e); }); return out; };

  if (totv === 2 && tote === 0 && totf === 0) return { edges: [BM_edge_create(bm, geom.verts[0], geom.verts[1], -1, BM_CREATE_NO_DOUBLE)], faces: [] };

  // A chain of edges and one free vert: two edges join the vert to the chain's ends.
  if (totf === 0 && totv >= 4 && totv === tote + 2) {
    let v_free = -1, v_a = -1, v_b = -1, ok = true;
    for (const v of geom.verts) {
      const n = flaggedEdgesOf(bm, v, ELE_NEW);
      if (n === 0) { if (v_free < 0) v_free = v; else ok = false; }
      else if (n === 1) { if (v_a < 0) v_a = v; else if (v_b < 0) v_b = v; else ok = false; }
      else if (n !== 2) ok = false;
      if (!ok) break;
    }
    if (ok && v_free >= 0 && v_a >= 0 && v_b >= 0) {
      for (const v of [v_a, v_b]) BMO_flag_enable(bm.e, BM_edge_create(bm, v_free, v, -1, BM_CREATE_NO_DOUBLE), ELE_NEW);
      tote += 2;
    }
  }

  if (tote) {
    for (const e of BMO_op_callf(bm, bmo_edgenet_prepare_exec, marked())) BMO_flag_enable(bm.e, e, ELE_NEW);
    const faces = BMO_op_callf(bm, bmo_edgenet_fill_exec, marked(), { mat_nr, use_smooth });
    if (faces.length) return { edges: [], faces };
  }
  if (totf) {
    const region = BMO_op_callf(bm, bmo_dissolve_faces_exec, geom.faces.filter((f) => bm.f.alive[f]));
    if (region?.length) return { edges: [], faces: region };
  }
  if (tote > 2) {
    const faces = BMO_op_callf(bm, bmo_edgeloop_fill_exec, marked(), { mat_nr, use_smooth });
    if (faces.length) return { edges: [], faces };
  }
  if (totv > 2) {
    const f = BM_face_create_ngon_verts(bm, BM_verts_sort_radial_plane(bm, geom.verts), -1, BM_CREATE_NO_DOUBLE, true, true);
    if (f >= 0) {
      BMO_flag_enable(bm.f, f, ELE_OUT);
      bm.f.mat_nr[f] = mat_nr;
      if (use_smooth) BM_elem_flag_enable(bm.f, f, BM_ELEM_SMOOTH);
      BM_face_copy_shared(bm, f);
      return { edges: [], faces: [f] };
    }
  }
  return { edges: [], faces: [] };
}
