// Edge Slide (transform_mode_edge_slide.cc, with transform_mesh_edge_slide_data_create from
// transform_convert_mesh.cc): selected edge loops slide along the faces beside them.
import { Vector3 } from '@babylonjs/core';
import { snap } from '../../windowmanager/gesture-math.js';
import { initNumInput, hasNumInput, applyNumInput, outputNumInput, handleNumInput } from '../util/numinput.js';
import { createKeymap } from '../../windowmanager/input/keymap.js';
import { BM_ITER_MESH, BM_ELEM_SELECT, BM_ELEM_HIDDEN, BM_elem_flag_test } from '../../bmesh/intern/bmesh-class.js';
import { BM_edge_exists, BM_edge_is_boundary, BM_edge_is_manifold, BM_vert_is_edge_pair, BM_EDGES_OF_VERT } from '../../bmesh/intern/bmesh-query.js';
import { sub_v3, add_v3, mul_v3_fl, dot_v3, cross_v3, len_v3, mid_v3, interp_v3, normalize_v3, line_point_factor_v3, isect_line_plane_v3, isect_line_line_epsilon_v3 } from '../../blenlib/math-geom.js';

const FLT_EPSILON = 1.1920929e-7;
const co = (bm, v) => Array.from(bm.v.co.subarray(v * 3, v * 3 + 3));
const BM_vert_is_boundary = (bm, v) => BM_EDGES_OF_VERT(bm, v).some((e) => BM_edge_is_boundary(bm, e));
const mesh_vert_is_inner = (bm, v) => BM_vert_is_edge_pair(bm, v) && !BM_vert_is_boundary(bm, v);

function BM_loop_calc_face_direction(bm, l) {
  const { l: L } = bm;
  return normalize_v3(add_v3(normalize_v3(sub_v3(co(bm, L.v[l]), co(bm, L.v[L.prev[l]]))), normalize_v3(sub_v3(co(bm, L.v[L.next[l]]), co(bm, L.v[l])))));
}

// The closest point on the n-gon's opposite side, for the slide distance across n-gons.
function bm_loop_calc_opposite_co(bm, l_tmp, plane_no) {
  const { l: L } = bm;
  const l_last = L.prev[l_tmp], p = co(bm, L.v[l_tmp]);
  let best = null, dist_best = Infinity, it = L.next[l_tmp];
  do {
    const a = co(bm, L.v[it]), b = co(bm, L.v[L.next[it]]);
    const isect = isect_line_plane_v3(a, b, p, plane_no);
    if (isect) {
      const fac = line_point_factor_v3(isect, a, b);
      if (fac > -FLT_EPSILON && fac < 1 + FLT_EPSILON) {
        const d = dot_v3(sub_v3(p, isect), sub_v3(p, isect));
        if (d < dist_best) { dist_best = d; best = isect; }
      }
    }
  } while ((it = L.next[it]) !== l_last);
  return best;
}

function isect_face_dst(bm, l) {
  const { l: L } = bm;
  if (bm.f.len[L.f[l]] === 4) return co(bm, L.v[L.next[L.next[l]]]);
  return bm_loop_calc_opposite_co(bm, l, BM_loop_calc_face_direction(bm, l)) ?? mid_v3(co(bm, L.v[L.prev[l]]), co(bm, L.v[L.next[l]]));
}

const emptySide = () => ({ f: -1, v_dst: -1, dst: [0, 0, 0] });
const emptyTemp = () => ({ i: 0, sv: null, v: -1, e: -1, fdata: [emptySide(), emptySide()], vert_is_edge_pair: false });
const copyTemp = (t) => ({ ...t, fdata: t.fdata.map((side) => ({ ...side, dst: [...side.dst] })) });

// The best of `self`'s two slide slots for the face `f_curr` reached from `l_src` towards `v_dst`.
function find_best_dir(bm, self, other, f_curr, l_src, v_dst) {
  const { l: L } = bm;
  if (f_curr === other.fdata[0].f || v_dst === other.fdata[0].v_dst) return [0, false];
  if (f_curr === other.fdata[1].f || v_dst === other.fdata[1].v_dst) return [1, false];
  if (other.fdata[0].f >= 0 || other.fdata[1].f >= 0) {
    const l_edge = L.v[L.next[l_src]] === v_dst ? l_src : L.prev[l_src];
    let l_other = L.radial_next[l_edge];
    while (L.f[l_other] !== L.f[l_edge]) {
      if (L.f[l_other] === other.fdata[0].f) return [0, true];
      if (L.f[l_other] === other.fdata[1].f) return [1, true];
      l_other = L.radial_next[L.v[l_other] === self.v ? L.prev[l_other] : L.next[l_other]];
    }
  }
  if (self.fdata[0].f < 0 || self.fdata[1].f < 0) return [self.fdata[0].f >= 0 ? 1 : 0, false];
  const edgeTo = (v) => (v >= 0 ? BM_edge_exists(bm, self.v, v) : -1);
  const boundary0 = edgeTo(self.fdata[0].v_dst) >= 0 && BM_edge_is_boundary(bm, edgeTo(self.fdata[0].v_dst));
  const boundary1 = edgeTo(self.fdata[1].v_dst) >= 0 && BM_edge_is_boundary(bm, edgeTo(self.fdata[1].v_dst));
  if (boundary0 && !boundary1) return [0, true];
  if (boundary1 && !boundary0) return [1, true];
  const src = co(bm, self.v), dir_curr = sub_v3(co(bm, v_dst), src);
  const dot0 = dot_v3(dir_curr, normalize_v3(sub_v3(self.fdata[0].dst, src)));
  const dot1 = dot_v3(dir_curr, normalize_v3(sub_v3(self.fdata[1].dst, src)));
  return [dot0 < dot1 ? 1 : 0, true];
}

// Where a vertex between two forking slide directions goes: the crossing of the lines through the neighbouring
// destinations when it lies in the cone between them (#144270), else the midpoint.
function isect_dirs(curr_orig, dst0, dst1, dst2, dst3) {
  const eps = FLT_EPSILON;
  let [count, i1, i2] = isect_line_line_epsilon_v3(dst0, dst1, dst2, dst3, eps);
  if (count) {
    const dir1 = normalize_v3(sub_v3(dst1, curr_orig)), dir2 = normalize_v3(sub_v3(dst2, curr_orig));
    const nc = cross_v3(dir1, dir2), len_n = len_v3(nc);
    if (len_n < eps) count = 0;
    else {
      const n = mul_v3_fl(nc, 1 / len_n);
      const p1 = cross_v3(n, dir1), p2 = cross_v3(dir2, n);
      if (len_v3(p1) < eps || len_v3(p2) < eps) count = 0;
      else if ([i1, i2].slice(0, count).some((p) => dot_v3(sub_v3(p, curr_orig), normalize_v3(p1)) <= 0 || dot_v3(sub_v3(p, curr_orig), normalize_v3(p2)) <= 0)) count = 0;
    }
  }
  return count ? mid_v3(i1, i2) : mid_v3(dst1, dst2);
}

// transform_mesh_edge_slide_data_create: one slide vert per selected vertex, with its two slide offsets
// (`dir_side`) and the loop it belongs to, or null for a selection that cannot slide.
export function transform_mesh_edge_slide_data_create(bm) {
  const { l: L } = bm;
  const verts = [];
  BM_ITER_MESH(bm.v, (v) => { if (BM_elem_flag_test(bm.v, v, BM_ELEM_SELECT) && !BM_elem_flag_test(bm.v, v, BM_ELEM_HIDDEN)) verts.push(v); });
  for (const v of verts) {
    const numsel = BM_EDGES_OF_VERT(bm, v).filter((e) => BM_elem_flag_test(bm.e, e, BM_ELEM_SELECT)).length;
    if (numsel === 0 || numsel > 2) return null;
  }
  let invalid = false;
  BM_ITER_MESH(bm.e, (e) => { if (BM_elem_flag_test(bm.e, e, BM_ELEM_SELECT) && !BM_edge_is_manifold(bm, e) && !BM_edge_is_boundary(bm, e)) invalid = true; });
  if (invalid || !verts.length) return null;

  const index = new Map(verts.map((v, i) => [v, i]));
  const sv_array = verts.map((v) => ({ v, iloc: co(bm, v), dir_side: [[0, 0, 0], [0, 0, 0]], edge_len: 0, loop_nr: -1 }));
  const td_connected = verts.map(() => [-1, -1]);
  BM_ITER_MESH(bm.e, (e) => {
    if (!BM_elem_flag_test(bm.e, e, BM_ELEM_SELECT)) return;
    const i1 = index.get(bm.e.v1[e]) ?? -1, i2 = index.get(bm.e.v2[e]) ?? -1;
    if (i1 < 0 || i2 < 0) return;
    td_connected[i1][td_connected[i1][0] !== -1 ? 1 : 0] = i2;
    td_connected[i2][td_connected[i2][0] !== -1 ? 1 : 0] = i1;
  });
  const other = (i, not) => (td_connected[i][0] !== not ? td_connected[i][0] : td_connected[i][1]);
  const fill = (t, i) => { t.i = i; if (i !== -1) { t.sv = sv_array[i]; t.v = t.sv.v; t.vert_is_edge_pair = mesh_vert_is_inner(bm, t.v); } };

  let loop_nr = 0;
  sv_array.forEach((sv, i) => {
    if (sv.loop_nr !== -1) return;
    // Start from a vertex with a single selected edge, if there is one.
    let i_curr = i, i_prev = td_connected[i][1];
    while (i_prev !== -1 && i_prev !== i) { const tmp = other(i_prev, i_curr); i_curr = i_prev; i_prev = tmp; }

    let prev = emptyTemp(), curr = emptyTemp(), next = emptyTemp(), next_next = emptyTemp();
    fill(next, other(i_curr, i_prev));
    fill(curr, i_curr);
    if (curr.i !== -1 && next.i !== -1) curr.e = BM_edge_exists(bm, curr.v, next.v);
    prev.i = -1;

    while (curr.i !== -1) {
      if (next.i !== -1) {
        fill(next_next, other(next.i, curr.i));
        if (next_next.i !== -1) next.e = BM_edge_exists(bm, next.v, next_next.v);
        const tmp = copyTemp(curr);
        const l0 = bm.e.l[curr.e];
        let lp = l0;
        if (l0 >= 0) do {
          const f_curr = L.f[lp];
          let l1, l2, l_edge_next, v1_dst, v2_dst;
          if (L.v[lp] === curr.v) { l1 = lp; l2 = L.next[lp]; l_edge_next = L.e[l2]; v1_dst = L.v[L.prev[l1]]; v2_dst = L.v[L.next[l2]]; }
          else { l1 = L.next[lp]; l2 = lp; l_edge_next = L.e[L.prev[l2]]; v1_dst = L.v[L.next[l1]]; v2_dst = L.v[L.prev[l2]]; }
          const dst = co(bm, v1_dst);
          const [best_dir, isect_curr_dirs] = find_best_dir(bm, curr, tmp, f_curr, l1, v1_dst);
          const side = curr.fdata[best_dir];
          if (side.f < 0) {
            side.f = f_curr;
            if (curr.vert_is_edge_pair) side.dst = isect_face_dst(bm, l1);
            else { side.v_dst = v1_dst; side.dst = dst; }
          }
          const nside = next.fdata[best_dir];
          nside.f = f_curr;
          if (l_edge_next === next.e || next.vert_is_edge_pair) { nside.v_dst = -1; nside.dst = isect_face_dst(bm, l2); }
          else { nside.v_dst = v2_dst; nside.dst = co(bm, v2_dst); }
          if (isect_curr_dirs) side.dst = isect_dirs(curr.sv.iloc, prev.fdata[best_dir].dst, side.dst, dst, nside.dst);
        } while ((lp = L.radial_next[lp]) !== l0);
      }
      const { sv: s } = curr;
      if (curr.fdata[0].f >= 0) s.dir_side[0] = sub_v3(curr.fdata[0].dst, s.iloc);
      if (curr.fdata[1].f >= 0) s.dir_side[1] = sub_v3(curr.fdata[1].dst, s.iloc);
      s.edge_len = len_v3(sub_v3(s.dir_side[0], s.dir_side[1]));
      s.loop_nr = loop_nr;
      // Back at the start of a closed loop: its first vertex was computed twice so its directions are right.
      if (i_prev !== -1 && prev.i === i_prev) break;
      prev = copyTemp(curr);
      curr = copyTemp(next);
      next = copyTemp(next_next);
    }
    loop_nr++;
  });
  return { sv: sv_array, group_len: loop_nr };
}

// Interpolates along the two segments v1 to v2 to v3.
function interp_line_v3_v3v3v3(v1, v2, v3, t) {
  const t_mid = line_point_factor_v3(v2, v1, v3), t_delta = t - t_mid;
  if (t_delta < 0) return Math.abs(t_mid) < FLT_EPSILON ? v2 : interp_v3(v1, v2, t / t_mid);
  const rest = 1 - t_mid;
  return Math.abs(rest) < FLT_EPSILON ? v3 : interp_v3(v2, v3, (t - t_mid) / rest);
}

export function edge_slide_apply_elem(sv, fac, curr_length_fac, curr_side_unclamp, use_clamp, use_even, use_flip) {
  const r = sv.iloc;
  if (!use_even) {
    if (use_clamp) return add_v3(r, mul_v3_fl(sv.dir_side[fac < 0 ? 1 : 0], Math.abs(fac)));
    let side = curr_side_unclamp;
    if (!len_v3(sv.dir_side[side])) side = side ? 0 : 1;
    return add_v3(r, mul_v3_fl(sv.dir_side[side], side === (fac < 0 ? 1 : 0) ? Math.abs(fac) : -Math.abs(fac)));
  }
  if (sv.edge_len <= FLT_EPSILON) return r;
  const fac_final = Math.min(sv.edge_len, curr_length_fac) / sv.edge_len;
  const a = add_v3(r, sv.dir_side[0]), b = add_v3(r, sv.dir_side[1]);
  return use_flip ? interp_line_v3_v3v3v3(b, r, a, fac_final) : interp_line_v3_v3v3v3(a, r, b, fac_final);
}

// transform.edge_slide without the mouse: slides by `value` (-1 to 1). Returns false when the selection cannot slide.
export function edge_slide_exec(bm, { value = 0, use_even = false, flipped = false, use_clamp = true } = {}) {
  const data = transform_mesh_edge_slide_data_create(bm);
  if (!data) return false;
  const curr_length_fac = use_even ? data.sv[0].edge_len * (((flipped ? value : -value) + 1) / 2) : 0;
  for (const sv of data.sv) bm.v.co.set(edge_slide_apply_elem(sv, value, curr_length_fac, value < 0 ? 1 : 0, use_clamp, use_even, flipped), sv.v * 3);
  return true;
}

// The modal Edge Slide, as a transform session for the editor's modal (see transform.js). The mouse moves
// along the screen direction of the slide edge nearest to it; E toggles Even, F flips, C or Alt unclamps.
export function beginEdgeSlide(bm, object, view, mouse) {
  const data = transform_mesh_edge_slide_data_create(bm);
  if (!data) return null;
  const world = object.computeWorldMatrix(true);
  const screen = (p) => view.project(Vector3.TransformCoordinates(new Vector3(p[0], p[2], p[1]), world));
  const projected = data.sv.map((sv) => [screen(add_v3(sv.iloc, sv.dir_side[0])), screen(add_v3(sv.iloc, sv.dir_side[1]))]);

  // calcEdgeSlide_mval_range: the nearest slide edge gives the mouse direction; loops facing the other way flip.
  let mval_dir = [0, 0], dist_best = Infinity, curr_sv_index = 0;
  const loop_dir = new Array(data.group_len).fill(null).map(() => [0, 0]), loop_maxdist = new Array(data.group_len).fill(Infinity);
  projected.forEach(([a, b], i) => {
    const dx = b.x - a.x, dy = b.y - a.y, len = dx * dx + dy * dy;
    const t = len ? Math.max(0, Math.min(1, ((mouse.x - a.x) * dx + (mouse.y - a.y) * dy) / len)) : 0;
    const dist = (mouse.x - a.x - t * dx) ** 2 + (mouse.y - a.y - t * dy) ** 2;
    if (dist < dist_best && len > 0.1) { dist_best = dist; mval_dir = [dx, dy]; curr_sv_index = i; }
    const nr = data.sv[i].loop_nr;
    if (dist < loop_maxdist[nr]) { loop_maxdist[nr] = dist; loop_dir[nr] = [dx, dy]; }
  });
  for (const sv of data.sv) {
    const d = loop_dir[sv.loop_nr];
    if (d[0] * mval_dir[0] + d[1] * mval_dir[1] < 0) sv.dir_side.reverse();
  }
  if (mval_dir[0] ** 2 + mval_dir[1] ** 2 < 0.1) mval_dir = [0, 100];
  const half = [mval_dir[0] / 2, mval_dir[1] / 2], half_len = half[0] ** 2 + half[1] ** 2;

  const state = { total: { x: 0, y: 0 }, ctrl: false, shift: false, alt: false, use_even: false, flipped: false, unclamp: false, side: 0, perc: 0, header: '' };
  const num = initNumInput();
  const use_clamp = () => state.unclamp === state.alt;
  function apply() {
    let perc = -(state.total.x * half[0] + state.total.y * half[1]) / half_len;
    if (state.ctrl) perc = snap(perc, state.shift ? 0.01 : 0.1);
    if (use_clamp() && !hasNumInput(num)) perc = Math.max(-1, Math.min(1, perc));
    const typed = [perc];
    applyNumInput(num, typed);
    perc = state.perc = typed[0];
    state.header = 'Edge Slide: ' + (hasNumInput(num) ? outputNumInput(num)[0] : perc.toFixed(4) + ' ');
    const curr_length_fac = state.use_even ? data.sv[curr_sv_index].edge_len * (((state.flipped ? perc : -perc) + 1) / 2) : 0;
    if (!state.use_even && use_clamp()) state.side = perc < 0 ? 1 : 0;
    for (const sv of data.sv) bm.v.co.set(edge_slide_apply_elem(sv, perc, curr_length_fac, state.side, use_clamp(), state.use_even, state.flipped), sv.v * 3);
  }
  const center = screen(data.sv[curr_sv_index].iloc);
  return {
    label: 'Edge Slide',
    start: { ...mouse },
    center,
    get value() { return state.perc; },
    get header() { return state.header; },
    update(dx, dy, event) {
      state.total.x += dx;
      state.total.y += dy;
      state.ctrl = event.ctrlKey;
      state.shift = event.shiftKey;
      state.alt = !!event.altKey;
      apply();
    },
    numinput(event, active = false) {
      if (event.value !== 'PRESS' || (active && !hasNumInput(num)) || !handleNumInput(num, event)) return false;
      apply();
      return true;
    },
    // Hard-coded in handleEventEdgeSlide, so these have no modal keymap names.
    keymap: createKeymap([
      { keys: 'E', run: () => { state.use_even = !state.use_even; apply(); } },
      { keys: 'F', run: () => { state.flipped = !state.flipped; apply(); } },
      { keys: 'C', run: () => { state.unclamp = !state.unclamp; apply(); } },
    ]),
    cancel() { for (const sv of data.sv) bm.v.co.set(sv.iloc, sv.v * 3); },
  };
}
