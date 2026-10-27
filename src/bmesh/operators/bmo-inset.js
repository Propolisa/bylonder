// Inset operators (bmo_inset.cc). UV interpolation of the inset faces (use_interpolate) is not ported yet: new
// faces copy the loop data of the faces they border, as with use_interpolate off.
import { BM_ITER_MESH, BM_ELEM_TAG, BM_elem_flag_test, BM_elem_flag_enable, BM_elem_flag_disable, BMO_flag_test, BMO_flag_enable } from '../intern/bmesh-class.js';
import { BM_edge_create, BM_elem_attrs_copy, BM_vert_splice, bmesh_kernel_edge_separate, bmesh_kernel_vert_separate } from '../intern/bmesh-core.js';
import { BM_face_create_verts } from '../intern/bmesh-construct.js';
import { BM_edge_is_boundary, BM_edge_other_vert, BM_edge_other_loop, BM_ITER_LOOPS_OF_VERT, BM_EDGES_OF_VERT } from '../intern/bmesh-query.js';
import { BM_mesh_normals_update } from '../intern/bmesh-mesh-normals.js';
import { angle_v3v3v3, sub_v3, add_v3, mul_v3_fl, dot_v3, cross_v3, len_v3, normalize_v3 } from '../../blenlib/math-geom.js';

const ELE_NEW = 1;
const SMALL_NUMBER = 1e-8;
const co = (bm, v) => Array.from(bm.v.co.subarray(v * 3, v * 3 + 3));
const fno = (bm, f) => Array.from(bm.f.no.subarray(f * 3, f * 3 + 3));
const shell_v3v3_normalized_to_dist = (a, b) => { const c = Math.abs(dot_v3(a, b)); return c < SMALL_NUMBER ? 1 : 1 / c; };
function shell_v3v3_mid_normalized_to_dist(a, b) {
  const ab = add_v3(a, b), len = len_v3(ab);
  const c = len ? Math.abs(dot_v3(a, mul_v3_fl(ab, 1 / len))) : 0;
  return c < SMALL_NUMBER ? 1 : 1 / c;
}
function BM_vert_calc_shell_factor(bm, v) {
  const { l } = bm, no = Array.from(bm.v.no.subarray(v * 3, v * 3 + 3));
  let shell = 0, angle = 0;
  BM_ITER_LOOPS_OF_VERT(bm, v, (lp) => {
    const n = fno(bm, l.f[lp]);
    if (!n[0] && !n[1] && !n[2]) return;
    const a = angle_v3v3v3(co(bm, l.v[l.prev[lp]]), co(bm, l.v[lp]), co(bm, l.v[l.next[lp]]));
    shell += shell_v3v3_normalized_to_dist(no, n) * a;
    angle += a;
  });
  return angle ? shell / angle : 1;
}

// The tagged face's loop on an edge between exactly one tagged face and at least one untagged one, or -1.
function bm_edge_is_mixed_face_tag(bm, lp) {
  if (lp < 0) return -1;
  let tot_tag = 0, tot_untag = 0, l_tag = -1, it = lp;
  do {
    if (BM_elem_flag_test(bm.f, bm.l.f[it], BM_ELEM_TAG)) { if (tot_tag === 1) return -1; l_tag = it; tot_tag++; }
    else tot_untag++;
  } while ((it = bm.l.radial_next[it]) !== lp);
  return tot_tag === 1 && tot_untag >= 1 ? l_tag : -1;
}

function BM_loop_other_vert_loop(bm, lp, v) {
  const { l } = bm, v_prev = BM_edge_other_vert(bm, l.e[lp], v);
  if (l.v[lp] === v) return l.v[l.prev[lp]] === v_prev ? l.next[lp] : l.prev[lp];
  return l.v[l.prev[lp]] === v ? l.prev[l.prev[lp]] : l.next[l.next[lp]];
}

// inset_region: insets the boundary between `faces` and the rest. Returns faces.out. Run through BMO_op_callf.
export function bmo_inset_region_exec(bm, faces, {
  use_boundary = false, use_even_offset = false, use_relative_offset = false, use_edge_rail = false,
  thickness = 0, depth = 0, use_outset = false,
} = {}) {
  const { l } = bm;
  use_boundary = use_boundary && !use_outset;
  const use_even_boundary = use_even_offset;
  BM_mesh_normals_update(bm);
  const vert_coords = new Map();

  BM_ITER_MESH(bm.f, (f) => (use_outset ? BM_elem_flag_enable : BM_elem_flag_disable)(bm.f, f, BM_ELEM_TAG));
  for (const f of faces) (use_outset ? BM_elem_flag_disable : BM_elem_flag_enable)(bm.f, f, BM_ELEM_TAG);

  let edge_info_len = 0;
  BM_ITER_MESH(bm.e, (e) => {
    const tag = (use_boundary && BM_edge_is_boundary(bm, e) && BM_elem_flag_test(bm.f, l.f[bm.e.l[e]], BM_ELEM_TAG)) || bm_edge_is_mixed_face_tag(bm, bm.e.l[e]) >= 0;
    const set = tag ? BM_elem_flag_enable : BM_elem_flag_disable;
    set(bm.v, bm.e.v1[e], BM_ELEM_TAG);
    set(bm.v, bm.e.v2[e], BM_ELEM_TAG);
    set(bm.e, e, BM_ELEM_TAG);
    bm.e.index[e] = tag ? edge_info_len++ : -1;
  });
  const edge_info = [];
  BM_ITER_MESH(bm.e, (e) => {
    if (bm.e.index[e] === -1) return;
    edge_info.push({ length: len_v3(sub_v3(co(bm, bm.e.v1[e]), co(bm, bm.e.v2[e]))), e_old: e, e_new: -1, l: -1, no: null });
  });

  edge_info.forEach((es, i) => {
    es.l = bm_edge_is_mixed_face_tag(bm, bm.e.l[es.e_old]);
    if (es.l < 0) es.l = bm.e.l[es.e_old];
    if (!BM_edge_is_boundary(bm, es.e_old)) bmesh_kernel_edge_separate(bm, es.e_old, es.l);
    es.e_new = l.e[es.l];
    es.no = normalize_v3(cross_v3(sub_v3(co(bm, l.v[es.l]), co(bm, l.v[l.next[es.l]])), fno(bm, l.f[es.l])));
    if (es.e_new === es.e_old) es.e_old = BM_edge_create(bm, bm.e.v1[es.e_new], bm.e.v2[es.e_new], es.e_new);
    bm.e.index[es.e_new] = i;
    BM_elem_flag_enable(bm.e, es.e_new, BM_ELEM_TAG);
    BM_elem_flag_enable(bm.v, bm.e.v1[es.e_new], BM_ELEM_TAG);
    BM_elem_flag_enable(bm.v, bm.e.v2[es.e_new], BM_ELEM_TAG);
  });

  for (const es of edge_info) {
    for (const v of [bm.e.v1[es.e_new], bm.e.v2[es.e_new]]) {
      if (!BM_elem_flag_test(bm.v, v, BM_ELEM_TAG)) continue;
      BM_elem_flag_disable(bm.v, v, BM_ELEM_TAG);
      const vout = bmesh_kernel_vert_separate(bm, v);
      if (vout.length === 1) {
        if (use_edge_rail) vert_coords.set(vout[0], co(bm, vout[0]));
        continue;
      }
      let v_glue = -1;
      for (const v_split of vout) {
        if (use_edge_rail) vert_coords.set(v_split, co(bm, v_split));
        const vecpair = [];
        let tot = 0;
        for (const e of BM_EDGES_OF_VERT(bm, v_split)) {
          if (BM_elem_flag_test(bm.e, e, BM_ELEM_TAG) && bm.e.l[e] >= 0 && BM_elem_flag_test(bm.f, l.f[bm.e.l[e]], BM_ELEM_TAG)) {
            if (tot < 2) vecpair[tot] = bm.e.index[e];
            tot++;
          }
        }
        if (tot) {
          let tvec;
          if (tot >= 2) {
            const a = edge_info[vecpair[0]], b = edge_info[vecpair[1]];
            let is_mid = true;
            tvec = add_v3(a.no, b.no);
            if (use_edge_rail && l.f[a.l] !== l.f[b.l]) {
              const other_a = BM_loop_other_vert_loop(bm, a.l, v_split), other_b = BM_loop_other_vert_loop(bm, b.l, v_split);
              if (l.v[other_a] === l.v[other_b]) {
                tvec = sub_v3(vert_coords.get(l.v[other_a]) ?? co(bm, l.v[other_a]), co(bm, v_split));
                is_mid = false;
              }
            }
            tvec = normalize_v3(tvec);
            if (use_even_offset) {
              const nearest = dot_v3(sub_v3(tvec, a.no), sub_v3(tvec, a.no)) > dot_v3(sub_v3(tvec, b.no), sub_v3(tvec, b.no)) ? a.no : b.no;
              tvec = mul_v3_fl(tvec, is_mid ? shell_v3v3_mid_normalized_to_dist(a.no, b.no) : shell_v3v3_normalized_to_dist(tvec, nearest));
            }
            if (use_relative_offset) tvec = mul_v3_fl(tvec, (a.length + b.length) / 2);
          } else {
            const e_no_a = edge_info[vecpair[0]].no;
            if (use_even_boundary) {
              // Align flush with the boundary edge, not the interior edge's normal.
              let lp = bm.e.l[bm.v.e[v_split]];
              if (l.v[l.prev[lp]] === v_split) lp = l.prev[lp];
              else if (l.v[l.next[lp]] === v_split) lp = l.next[lp];
              const e_other = !BM_elem_flag_test(bm.e, l.e[lp], BM_ELEM_TAG) ? l.e[lp] : l.e[l.prev[lp]];
              tvec = normalize_v3(sub_v3(co(bm, BM_edge_other_vert(bm, e_other, v_split)), co(bm, v_split)));
              if (use_even_offset) tvec = mul_v3_fl(tvec, shell_v3v3_normalized_to_dist(e_no_a, tvec));
            } else tvec = e_no_a;
            if (use_relative_offset) tvec = mul_v3_fl(tvec, edge_info[vecpair[0]].length);
          }
          bm.v.co.set(add_v3(co(bm, v_split), mul_v3_fl(tvec, thickness)), v_split * 3);
        }
        // Glue split verts that use no tagged face back together.
        if (vout.length > 2) {
          let ok = true;
          BM_ITER_LOOPS_OF_VERT(bm, v_split, (lp) => { if (BM_elem_flag_test(bm.f, l.f[lp], BM_ELEM_TAG)) ok = false; });
          if (ok) {
            if (v_glue < 0) v_glue = v_split;
            else if (BM_vert_splice(bm, v_glue, v_split)) vert_coords.delete(v_split);
          }
        }
      }
    }
  }

  for (const es of edge_info) {
    const varr = [l.v[l.next[es.l]], l.v[es.l]];
    const [n1, n2, o1, o2] = [bm.e.v1[es.e_new], bm.e.v2[es.e_new], bm.e.v1[es.e_old], bm.e.v2[es.e_old]];
    if (varr[0] === n1) { if (o2 !== n2) varr.push(o2); if (o1 !== n1) varr.push(o1); }
    else { if (o1 !== n1) varr.push(o1); if (o2 !== n2) varr.push(o2); }
    if (varr.length === 2) continue;
    const f = BM_face_create_verts(bm, varr, l.f[es.l]);
    BMO_flag_enable(bm.f, f, ELE_NEW);
    // Loop data from the faces beside the new one: the original face's corners on the inner side.
    let l_a = bm.f.l_first[f], l_b = l.next[l_a];
    const l_a_other = BM_edge_other_loop(bm, l.e[l_a], l_a), l_b_other = BM_edge_other_loop(bm, l.e[l_a], l_b);
    BM_elem_attrs_copy(bm.l, l_a_other, l_a);
    BM_elem_attrs_copy(bm.l, l_b_other, l_b);
    l_a = l.next[l.next[l_a]];
    l_b = l.next[l_a];
    BM_elem_attrs_copy(bm.l, l_a_other, l_b);
    BM_elem_attrs_copy(bm.l, l_b_other, l_a);
  }
  const faces_out = [];
  BM_ITER_MESH(bm.f, (f) => BMO_flag_test(bm.f, f, ELE_NEW) && faces_out.push(f));

  if (depth) {
    const vno = (v) => bm.v.no.subarray(v * 3, v * 3 + 3);
    for (const es of edge_info) for (const v of [bm.e.v1[es.e_new], bm.e.v2[es.e_new]]) vno(v).fill(0);
    for (const es of edge_info) for (const v of [bm.e.v1[es.e_new], bm.e.v2[es.e_new]]) { const n = fno(bm, l.f[es.l]); for (let a = 0; a < 3; a++) vno(v)[a] += n[a]; }
    for (const es of edge_info) for (const v of [bm.e.v1[es.e_new], bm.e.v2[es.e_new]]) { const n = vno(v), len2 = n[0] ** 2 + n[1] ** 2 + n[2] ** 2; if (len2 !== 1) n.set(normalize_v3(Array.from(n))); }
    BM_ITER_MESH(bm.v, (v) => BM_elem_flag_disable(bm.v, v, BM_ELEM_TAG));
    for (const f of faces) {
      const first = bm.f.l_first[f];
      let lp = first;
      do { BM_elem_flag_enable(bm.v, l.v[lp], BM_ELEM_TAG); BM_elem_flag_enable(bm.e, l.e[lp], BM_ELEM_TAG); } while ((lp = l.next[lp]) !== first);
    }
    const averageLength = (v) => {
      let len = 0, tot = 0;
      for (const e of BM_EDGES_OF_VERT(bm, v)) if (bm.e.index[e] !== -1) { len += edge_info[bm.e.index[e]].length; tot++; }
      return tot ? len / tot : -1;
    };
    let vert_lengths = null;
    // bm_edge_info_average_length_fallback: interior verts away from the inset edges average the lengths of
    // their tagged neighbours, spreading inwards pass by pass.
    const fallbackLength = (v_lookup) => {
      if (!vert_lengths) {
        vert_lengths = new Map();
        const stack = [];
        BM_ITER_MESH(bm.e, (e) => {
          if (bm.e.index[e] === -1) return;
          for (const v of [bm.e.v1[e], bm.e.v2[e]]) {
            if (BM_elem_flag_test(bm.v, v, BM_ELEM_TAG) && !vert_lengths.has(v)) {
              stack.push(v);
              vert_lengths.set(v, { length_accum: averageLength(v), count: 1 });
            }
          }
        });
        while (stack.length) {
          for (let i = stack.length - 1; i >= 0; i--) {
            const v = stack[i];
            // STACK_REMOVE: the last entry takes its place.
            const last = stack.pop();
            if (i < stack.length) stack[i] = last;
            const vl = vert_lengths.get(v);
            vl.length_accum /= vl.count;
            vl.count = -1;
            for (const e of BM_EDGES_OF_VERT(bm, v)) {
              if (!BM_elem_flag_test(bm.e, e, BM_ELEM_TAG)) continue;
              const v_other = BM_edge_other_vert(bm, e, v);
              if (!BM_elem_flag_test(bm.v, v_other, BM_ELEM_TAG)) continue;
              const other = vert_lengths.get(v_other) ?? { length_accum: 0, count: 0 };
              if (other.count < 0) continue;
              if (other.count === 0) { stack.push(v_other); vert_lengths.set(v_other, other); }
              other.count += 1;
              other.length_accum += vl.length_accum;
            }
          }
        }
      }
      return vert_lengths.get(v_lookup)?.length_accum ?? 0;
    };
    const moved = [];
    BM_ITER_MESH(bm.v, (v) => {
      if (!BM_elem_flag_test(bm.v, v, BM_ELEM_TAG)) return;
      const average = use_relative_offset ? averageLength(v) : 1;
      const fac = depth * (average === -1 ? fallbackLength(v) : average) * (use_even_boundary ? BM_vert_calc_shell_factor(bm, v) : 1);
      moved.push([v, add_v3(co(bm, v), mul_v3_fl(Array.from(vno(v)), fac))]);
    });
    for (const [v, p] of moved) bm.v.co.set(p, v * 3);
  }
  return faces_out;
}
