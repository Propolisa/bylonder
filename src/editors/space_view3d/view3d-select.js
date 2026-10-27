// Box select in Edit Mode (do_mesh_box_select in view3d_select.cc). In solid shading Blender tests visibility with
// its select buffer; here an element counts as visible when the ray to it (to an edge's or face's middle) is not
// blocked, as for click select.
import { BM_VERT, BM_EDGE, BM_FACE } from '../../bmesh/intern/bmesh-class.js';
import { SCE_SELECT_VERTEX, SCE_SELECT_EDGE, SCE_SELECT_FACE } from '../../bmesh/intern/bmesh-marking.js';

// eSelectOp: SET replaces, ADD extends (Shift), SUB subtracts (Ctrl), XOR toggles.
export const SEL_OP_ADD = 1, SEL_OP_SUB = 2, SEL_OP_SET = 3, SEL_OP_XOR = 5;

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

// `view` as editmesh-select describes it; `rect` in client pixels { xmin, xmax, ymin, ymax }. Reads the edit mesh's
// Mesh arrays and selects in the edit mesh (an EditMesh).
export function do_mesh_box_select(edit, mesh, view, rect, sel_op) {
  const co = (v) => mesh.vert_positions.subarray(v * 3, v * 3 + 3);
  const visible = (p) => view.xray || !view.occluded(p);
  const { selectmode } = edit;
  let changed = false;
  // Selected before this select, or nothing once SET has cleared it.
  const clear = sel_op === SEL_OP_SET && edit.totals.totvertsel > 0;
  if (clear) {
    edit.run('mesh.select_all', { action: 'DESELECT' });
    changed = true;
  }
  const was = (name) => (clear ? new Uint8Array(mesh.attribute(name).length) : mesh.attribute(name));
  // The elements whose selection changes, in order: [indices, selects].
  const actions = (selected, candidates) => {
    const out = [[], []];
    for (const [i, is_inside] of candidates) {
      const result = ED_select_op_action_deselected(sel_op, !!selected[i], is_inside);
      if (result !== -1) { out[0].push(i); out[1].push(result === 1); }
    }
    return out;
  };
  const apply = (htype, [indices, selects]) => {
    if (!indices.length) return false;
    edit.selectElements(htype, indices, selects);
    return (changed = true);
  };
  if (selectmode & SCE_SELECT_VERTEX) {
    const hidden = mesh.attribute('.hide_vert'), candidates = [];
    for (let v = 0; v < mesh.verts_num; v++) {
      if (hidden[v]) continue;
      const p = view.project(co(v));
      candidates.push([v, !!p && inside(rect, p) && visible(co(v))]);
    }
    apply(BM_VERT, actions(was('.select_vert'), candidates));
  }
  if (selectmode & SCE_SELECT_EDGE) {
    const hidden = mesh.attribute('.hide_edge'), edges = [];
    for (let e = 0; e < mesh.edges_num; e++) {
      if (hidden[e]) continue;
      const c1 = co(mesh.edges[e * 2]), c2 = co(mesh.edges[e * 2 + 1]), a = view.project(c1), b = view.project(c2);
      if (!a || !b) continue;
      edges.push([e, a, b, visible([0, 1, 2].map((k) => (c1[k] + c2[k]) / 2))]);
    }
    // Edges fully inside first; only when there are none, edges that cross the box.
    const selected = was('.select_edge');
    if (!apply(BM_EDGE, actions(selected, edges.map(([e, a, b, vis]) => [e, vis && inside(rect, a) && inside(rect, b)])))) {
      apply(BM_EDGE, actions(selected, edges.map(([e, a, b, vis]) => [e, vis && segmentCrossesRect(rect, a, b)])));
    }
  }
  if (selectmode & SCE_SELECT_FACE) {
    const hidden = mesh.attribute('.hide_poly'), candidates = [];
    for (let f = 0; f < mesh.faces_num; f++) {
      if (hidden[f]) continue;
      const start = mesh.face_offsets[f], end = mesh.face_offsets[f + 1], center = [0, 0, 0];
      for (let c = start; c < end; c++) for (let k = 0; k < 3; k++) center[k] += co(mesh.corner_verts[c])[k] / (end - start);
      const p = view.project(center);
      candidates.push([f, !!p && inside(rect, p) && visible(center)]);
    }
    apply(BM_FACE, actions(was('.select_poly'), candidates));
  }
  if (changed) edit.selectFlush();
  return changed;
}
