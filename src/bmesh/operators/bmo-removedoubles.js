// Welding and merging (bmo_removedoubles.cc): weld_verts, pointmerge and collapse.
import { BM_ITER_MESH, BM_VERT, BM_EDGE, BM_FACE, BM_ELEM_HIDDEN, BM_ELEM_TAG, BM_elem_flag_test, BM_elem_flag_enable, BM_elem_flag_disable, BM_elem_flag_merge_ex, BMO_flag_test, BMO_flag_enable, BMO_flag_disable } from '../intern/bmesh-class.js';
import { BM_edge_create, BM_face_create, BM_face_kill, bmesh_face_swap_data } from '../intern/bmesh-core.js';
import { BM_elem_attrs_copy } from '../intern/bmesh-construct.js';
import { BM_face_split } from '../intern/bmesh-mods.js';
import { BM_edge_exists, BM_face_exists, BM_face_vert_share_loop, BM_loop_is_adjacent } from '../intern/bmesh-query.js';
import { BM_select_history_merge_from_targetmap } from '../intern/bmesh-marking.js';
import { BMO_mesh_delete_oflag_context, DEL_ONLYTAGGED } from '../intern/bmesh-delete.js';
import { BMW_vert_shell } from '../intern/bmesh-walkers.js';
import { BMO_op_callf } from '../intern/bmesh-operators.js';
import { add_v3, mul_v3_fl } from '../../blenlib/math-geom.js';
import { kdtree_build, kdtree_calc_duplicates_cb } from '../../blenlib/kdtree.js';

const ELE_DEL = 1, EDGE_COL = 2, VERT_IN_FACE = 4;
const EDGE_MARK = 1;
const loopsOf = (bm, f) => { const out = [], first = bm.f.l_first[f]; let l = first; do out.push(l); while ((l = bm.l.next[l]) !== first); return out; };

// Splits a face whose corners are about to merge with corners that are not their neighbours.
function remdoubles_splitface(bm, f, targetmap) {
  let l_double = -1, l_tar = -1;
  for (const l of loopsOf(bm, f)) {
    const v_tar = targetmap.get(bm.l.v[l]);
    if (v_tar === undefined) continue;
    const found = BM_face_vert_share_loop(bm, f, v_tar);
    if (found >= 0 && found !== l && !BM_loop_is_adjacent(bm, found, l)) { l_double = l; l_tar = found; break; }
  }
  if (l_double < 0) return;
  const [f_new] = BM_face_split(bm, f, l_double, l_tar);
  remdoubles_splitface(bm, f, targetmap);
  remdoubles_splitface(bm, f_new, targetmap);
}

// The face `f` becomes once its verts are mapped: { f, created }, or null when fewer than 3 corners remain.
function remdoubles_createface(bm, f, targetmap) {
  const { l } = bm, edges = [], loops = [], verts = [];
  const mapped = (lp) => { const v = l.v[lp], del = BMO_flag_test(bm.v, v, ELE_DEL); return [del ? targetmap.get(v) : v, del]; };
  let bail = false;
  const first = bm.f.l_first[f];
  let l_curr = first, [v_curr, is_del_v_curr] = mapped(l_curr);
  do {
    const l_next = l.next[l_curr], [v_next, is_del_v_next] = mapped(l_next);
    const e_new = !is_del_v_curr && !is_del_v_next ? l.e[l_curr] : v_curr === v_next ? -1 : BM_edge_exists(bm, v_curr, v_next);
    if (e_new >= 0) {
      if (BMO_flag_test(bm.v, v_curr, VERT_IN_FACE)) { bail = true; break; }
      BMO_flag_enable(bm.v, v_curr, VERT_IN_FACE);
      edges.push(e_new);
      loops.push(l_curr);
      verts.push(v_curr);
    }
    v_curr = v_next;
    is_del_v_curr = is_del_v_next;
  } while ((l_curr = l.next[l_curr]) !== first);
  for (const v of verts) BMO_flag_disable(bm.v, v, VERT_IN_FACE);
  if (bail || edges.length < 3) return null;
  const existing = BM_face_exists(bm, verts);
  if (existing >= 0) return { f: existing, created: false };
  const f_new = BM_face_create(bm, verts, edges, edges.length, f);
  loopsOf(bm, f_new).forEach((lp, i) => BM_elem_attrs_copy(bm.l, loops[i], lp));
  return { f: f_new, created: true };
}

// weld_verts: each vert in `targetmap` (a Map from vert to vert) merges into its target.
export function bmo_weld_verts_exec(bm, { targetmap, use_centroid = false }) {
  const has_selected = bm.selected.length > 0;
  const targetmap_all = { [BM_VERT]: new Map(), [BM_EDGE]: new Map(), [BM_FACE]: new Map() };
  const clusters = new Map();
  BM_ITER_MESH(bm.v, (v) => {
    const v_dst = targetmap.get(v);
    if (v_dst === undefined) return;
    BMO_flag_enable(bm.v, v, ELE_DEL);
    BM_elem_flag_merge_ex(bm.v, v, bm.v, v_dst, BM_ELEM_HIDDEN);
    if (has_selected) targetmap_all[BM_VERT].set(v, v_dst);
    if (use_centroid && v_dst !== v) clusters.set(v_dst, [...(clusters.get(v_dst) ?? []), v]);
  });
  for (const [v_dst, cluster] of clusters) {
    const co = (v) => [...bm.v.co.subarray(v * 3, v * 3 + 3)];
    bm.v.co.set(mul_v3_fl(cluster.reduce((sum, v) => add_v3(sum, co(v)), co(v_dst)), 1 / (cluster.length + 1)), v_dst * 3);
  }

  BM_ITER_MESH(bm.f, (f) => remdoubles_splitface(bm, f, targetmap));

  BM_ITER_MESH(bm.e, (e) => {
    let v1 = bm.e.v1[e], v2 = bm.e.v2[e];
    const is_del_v1 = BMO_flag_test(bm.v, v1, ELE_DEL), is_del_v2 = BMO_flag_test(bm.v, v2, ELE_DEL);
    if (!is_del_v1 && !is_del_v2) return;
    if (is_del_v1) v1 = targetmap.get(v1);
    if (is_del_v2) v2 = targetmap.get(v2);
    if (v1 === v2) BMO_flag_enable(bm.e, e, EDGE_COL);
    else {
      let e_new = BM_edge_exists(bm, v1, v2);
      if (e_new < 0) e_new = BM_edge_create(bm, v1, v2, e);
      BM_elem_flag_merge_ex(bm.e, e_new, bm.e, e, BM_ELEM_HIDDEN);
      if (has_selected) targetmap_all[BM_EDGE].set(e, e_new);
    }
    BMO_flag_enable(bm.e, e, ELE_DEL);
  });

  // Faces are rebuilt as new faces whose data is swapped into the old ones; the leftovers are deleted at the end.
  BM_ITER_MESH(bm.f, (f) => {
    const loops = loopsOf(bm, f);
    if (!loops.some((lp) => BMO_flag_test(bm.v, bm.l.v[lp], ELE_DEL))) return;
    const edge_collapse = loops.filter((lp) => BMO_flag_test(bm.e, bm.l.e[lp], EDGE_COL)).length;
    BMO_flag_enable(bm.f, f, ELE_DEL);
    if (bm.f.len[f] - edge_collapse < 3) return;
    const made = remdoubles_createface(bm, f, targetmap);
    if (!made) return;
    if (made.created) {
      bmesh_face_swap_data(bm, made.f, f);
      const oflag = bm.f.oflag[f];
      bm.f.oflag[f] = bm.f.oflag[made.f];
      bm.f.oflag[made.f] = oflag;
      BMO_flag_disable(bm.f, f, ELE_DEL);
      BM_face_kill(bm, made.f);
      return;
    }
    BM_elem_flag_merge_ex(bm.f, made.f, bm.f, f, BM_ELEM_HIDDEN);
    if (has_selected) targetmap_all[BM_FACE].set(f, made.f);
    if (bm.act_face === f) bm.act_face = made.f;
  });

  if (has_selected) BM_select_history_merge_from_targetmap(bm, targetmap_all);
  BMO_mesh_delete_oflag_context(bm, ELE_DEL, DEL_ONLYTAGGED);
}

// pointmerge: `verts` merge at `merge_co`, into `vert_target` when given, else into the first of them.
export function bmo_pointmerge_exec(bm, { verts, merge_co, vert_target = -1 }) {
  const targetmap = new Map();
  for (const v of verts) {
    if (vert_target < 0) {
      vert_target = v;
      bm.v.co.set(merge_co, v * 3);
    } else if (v !== vert_target) targetmap.set(v, vert_target);
  }
  BMO_op_callf(bm, bmo_weld_verts_exec, { targetmap });
}

// collapse: each group of connected `edges` collapses to its center.
export function bmo_collapse_exec(bm, { edges }) {
  for (const e of edges) BMO_flag_enable(bm.e, e, EDGE_MARK);
  const targetmap = new Map(), visited = new Set();
  BM_ITER_MESH(bm.e, (e) => {
    if (!BMO_flag_test(bm.e, e, EDGE_MARK)) return;
    const group = BMW_vert_shell(bm, bm.e.v1[e], { mask_edge: EDGE_MARK, visited });
    if (!group.length) return;
    let center = [0, 0, 0];
    for (const g of group) {
      for (const v of [bm.e.v1[g], bm.e.v2[g]]) {
        center = add_v3(center, [...bm.v.co.subarray(v * 3, v * 3 + 3)]);
        BM_elem_flag_disable(bm.v, v, BM_ELEM_TAG);
      }
    }
    center = mul_v3_fl(center, 1 / (group.length * 2));
    const v_tar = bm.e.v1[group.at(-1)];
    for (const g of [...group].reverse()) {
      for (const v_src of [bm.e.v1[g], bm.e.v2[g]]) {
        bm.v.co.set(center, v_src * 3);
        if (v_src !== v_tar && !BM_elem_flag_test(bm.v, v_src, BM_ELEM_TAG)) {
          BM_elem_flag_enable(bm.v, v_src, BM_ELEM_TAG);
          targetmap.set(v_src, v_tar);
        }
      }
    }
  });
  BMO_op_callf(bm, bmo_weld_verts_exec, { targetmap });
}

const f32 = Math.fround;

// bmesh_find_doubles_by_distance_impl: for each vert the index it merges into, or -1; null when none merge.
function find_doubles_by_distance(positions, dist) {
  const duplicates = new Array(positions.length).fill(-1);
  // Two pick the lower index; more pick the one nearest their centroid, the lower index on ties.
  const target = (cluster) => {
    if (cluster.length === 2) return cluster[0] < cluster[1] ? 0 : 1;
    const sum = [0, 0, 0];
    for (const i of cluster) for (let a = 0; a < 3; a++) sum[a] = f32(sum[a] + positions[i][a]);
    const centroid = sum.map((x) => f32(x / cluster.length));
    const dist_sq = (i) => positions[i].reduce((s, x, a) => f32(s + f32(f32(x - centroid[a]) ** 2)), 0);
    let best = cluster.length - 1, best_sq = dist_sq(cluster[best]);
    for (let i = 0; i < cluster.length - 1; i++) {
      const d = dist_sq(cluster[i]);
      if (d > best_sq || (d === best_sq && cluster[i] > cluster[best])) continue;
      best = i;
      best_sq = d;
    }
    return best;
  };
  return kdtree_calc_duplicates_cb(kdtree_build(positions), dist, duplicates, false, target) ? duplicates : null;
}

// find_doubles then weld_verts: `verts` closer than `dist` merge. Returns how many were removed.
export function bmo_remove_doubles_exec(bm, { verts, dist, use_centroid = false }) {
  const duplicates = find_doubles_by_distance(verts.map((v) => [...bm.v.co.subarray(v * 3, v * 3 + 3)]), dist);
  const targetmap = new Map();
  duplicates?.forEach((d, i) => { if (d !== -1 && d !== i) targetmap.set(verts[i], verts[d]); });
  const before = bm.totvert;
  BMO_op_callf(bm, bmo_weld_verts_exec, { targetmap, use_centroid });
  return before - bm.totvert;
}
