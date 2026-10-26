// Box select in Edit Mode (do_mesh_box_select in view3d_select.cc). In solid shading Blender tests visibility with
// its select buffer; here an element counts as visible when the ray to it (to an edge's or face's middle) is not
// blocked, as for click select.
import { BM_ITER_MESH, BM_ELEM_SELECT, BM_ELEM_HIDDEN, BM_elem_flag_test } from '../../bmesh/intern/bmesh-class.js';
import {
  SCE_SELECT_VERTEX, SCE_SELECT_EDGE, SCE_SELECT_FACE, BM_vert_select_set, BM_edge_select_set, BM_face_select_set,
  BM_mesh_elem_hflag_disable_all, BM_mesh_select_mode_flush,
} from '../../bmesh/intern/bmesh-marking.js';
import { BM_VERT, BM_EDGE, BM_FACE } from '../../bmesh/intern/bmesh-class.js';

// eSelectOp: SET replaces, ADD extends (Shift), SUB subtracts (Ctrl).
export const SEL_OP_ADD = 1, SEL_OP_SUB = 2, SEL_OP_SET = 3;

// ED_select_op_action_deselected: 1 to select, 0 to deselect, -1 to leave as is.
function ED_select_op_action_deselected(sel_op, is_select, is_inside) {
  if (sel_op === SEL_OP_SUB) return is_select && is_inside ? 0 : -1;
  return !is_select && is_inside ? 1 : -1;
}

const inside = (r, p) => p[0] >= r.xmin && p[0] <= r.xmax && p[1] >= r.ymin && p[1] <= r.ymax;
function segmentCrossesRect(r, a, b) {
  if (inside(r, a) || inside(r, b)) return true;
  const cross = (p, q, s, t) => {
    const d = (q[0] - p[0]) * (t[1] - s[1]) - (q[1] - p[1]) * (t[0] - s[0]);
    if (!d) return false;
    const u = ((s[0] - p[0]) * (t[1] - s[1]) - (s[1] - p[1]) * (t[0] - s[0])) / d, v = ((s[0] - p[0]) * (q[1] - p[1]) - (s[1] - p[1]) * (q[0] - p[0])) / d;
    return u >= 0 && u <= 1 && v >= 0 && v <= 1;
  };
  const c = [[r.xmin, r.ymin], [r.xmax, r.ymin], [r.xmax, r.ymax], [r.xmin, r.ymax]];
  return c.some((p, i) => cross(a, b, p, c[(i + 1) % 4]));
}

// `view` as editmesh-select describes it; `rect` in client pixels { xmin, xmax, ymin, ymax }.
export function do_mesh_box_select(bm, view, rect, sel_op) {
  const co = (v) => bm.v.co.subarray(v * 3, v * 3 + 3);
  const visible = (p) => view.xray || !view.occluded(p);
  const shown = (pool, i) => !BM_elem_flag_test(pool, i, BM_ELEM_HIDDEN);
  let changed = false;
  const apply = (pool, i, is_inside, set) => {
    const result = ED_select_op_action_deselected(sel_op, BM_elem_flag_test(pool, i, BM_ELEM_SELECT), is_inside);
    if (result !== -1) { set(bm, i, !!result); changed = true; }
    return result !== -1;
  };
  if (sel_op === SEL_OP_SET && bm.totvertsel) { BM_mesh_elem_hflag_disable_all(bm, BM_VERT | BM_EDGE | BM_FACE, BM_ELEM_SELECT); changed = true; }
  if (bm.selectmode & SCE_SELECT_VERTEX) {
    BM_ITER_MESH(bm.v, (v) => {
      if (!shown(bm.v, v)) return;
      const p = view.project(co(v));
      apply(bm.v, v, !!p && inside(rect, p) && visible(co(v)), BM_vert_select_set);
    });
  }
  if (bm.selectmode & SCE_SELECT_EDGE) {
    const edges = [];
    BM_ITER_MESH(bm.e, (e) => {
      if (!shown(bm.e, e)) return;
      const a = view.project(co(bm.e.v1[e])), b = view.project(co(bm.e.v2[e]));
      if (!a || !b) return;
      const mid = [0, 1, 2].map((k) => (co(bm.e.v1[e])[k] + co(bm.e.v2[e])[k]) / 2);
      edges.push([e, a, b, visible(mid)]);
    });
    // Edges fully inside first; only when there are none, edges that cross the box.
    let done = false;
    for (const [e, a, b, vis] of edges) if (apply(bm.e, e, vis && inside(rect, a) && inside(rect, b), BM_edge_select_set)) done = true;
    if (!done) for (const [e, a, b, vis] of edges) apply(bm.e, e, vis && segmentCrossesRect(rect, a, b), BM_edge_select_set);
  }
  if (bm.selectmode & SCE_SELECT_FACE) {
    BM_ITER_MESH(bm.f, (f) => {
      if (!shown(bm.f, f)) return;
      const center = [0, 0, 0], first = bm.f.l_first[f];
      let l = first;
      do for (let k = 0; k < 3; k++) center[k] += co(bm.l.v[l])[k] / bm.f.len[f]; while ((l = bm.l.next[l]) !== first);
      const p = view.project(center);
      apply(bm.f, f, !!p && inside(rect, p) && visible(center), BM_face_select_set);
    });
  }
  if (changed) BM_mesh_select_mode_flush(bm);
  return changed;
}
