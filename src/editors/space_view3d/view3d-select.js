// Box, lasso and circle select in Edit Mode (do_mesh_box_select, do_mesh_lasso_select and mesh_circle_select in
// view3d_select.cc). In solid shading Blender tests visibility with its select buffer; here an element counts as
// visible when the ray to it (to an edge's or face's middle) is not blocked, as for click select.
import { BM_VERT, BM_EDGE, BM_FACE } from '../../bmesh/intern/bmesh-class.js';
import { SCE_SELECT_VERTEX, SCE_SELECT_EDGE, SCE_SELECT_FACE } from '../../bmesh/intern/bmesh-marking.js';

// eSelectOp: SET replaces, ADD extends (Shift), SUB subtracts (Ctrl), AND intersects, XOR toggles.
export const SEL_OP_ADD = 1, SEL_OP_SUB = 2, SEL_OP_SET = 3, SEL_OP_AND = 4, SEL_OP_XOR = 5;
export const SEL_OPS = { ADD: SEL_OP_ADD, SUB: SEL_OP_SUB, SET: SEL_OP_SET, AND: SEL_OP_AND, XOR: SEL_OP_XOR };

// ED_select_op_action_deselected: 1 to select, 0 to deselect, -1 to leave as is.
function ED_select_op_action_deselected(sel_op, is_select, is_inside) {
  switch (sel_op) {
    case SEL_OP_SUB: return is_select && is_inside ? 0 : -1;
    case SEL_OP_AND: return is_select && !is_inside ? 0 : -1;
    case SEL_OP_XOR: return is_inside ? (is_select ? 0 : 1) : -1;
    default: return !is_select && is_inside ? 1 : -1;
  }
}

const segmentsCross = (p, q, s, t) => {
  const d = (q[0] - p[0]) * (t[1] - s[1]) - (q[1] - p[1]) * (t[0] - s[0]);
  if (!d) return false;
  const u = ((s[0] - p[0]) * (t[1] - s[1]) - (s[1] - p[1]) * (t[0] - s[0])) / d, v = ((s[0] - p[0]) * (q[1] - p[1]) - (s[1] - p[1]) * (q[0] - p[0])) / d;
  return u >= 0 && u <= 1 && v >= 0 && v <= 1;
};
const insidePolygon = (polygon, [x, y]) => {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i], [xj, yj] = polygon[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
const crossesPolygon = (polygon, a, b) => polygon.some((p, i) => segmentsCross(a, b, p, polygon[(i + 1) % polygon.length]));

// The regions: whether a point is inside, and whether an edge crosses it (box and lasso: edges fully inside first).
export const boxRegion = (r) => {
  const corners = [[r.xmin, r.ymin], [r.xmax, r.ymin], [r.xmax, r.ymax], [r.xmin, r.ymax]];
  const point = (p) => p[0] >= r.xmin && p[0] <= r.xmax && p[1] >= r.ymin && p[1] <= r.ymax;
  return { point, edge: (a, b) => point(a) || point(b) || crossesPolygon(corners, a, b), edgesInsideFirst: true };
};
// BLI_lasso_is_point_inside, BLI_lasso_is_edge_inside.
export const lassoRegion = (path) => {
  const point = (p) => insidePolygon(path, p);
  return { point, edge: (a, b) => point(a) || point(b) || crossesPolygon(path, a, b), edgesInsideFirst: true };
};
// edge_inside_circle: an edge within the radius of the center.
export const circleRegion = ([cx, cy], radius) => {
  const point = ([x, y]) => (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
  const edge = ([ax, ay], [bx, by]) => {
    const dx = bx - ax, dy = by - ay, length = dx * dx + dy * dy;
    const t = length ? Math.max(0, Math.min(1, ((cx - ax) * dx + (cy - ay) * dy) / length)) : 0;
    return point([ax + t * dx, ay + t * dy]);
  };
  return { point, edge, edgesInsideFirst: false, circle: true };
};

// `view` as editmesh-select describes it; `region` one of the above in client pixels. Reads the edit mesh's Mesh
// arrays and selects in the edit mesh (an EditMesh).
export function do_mesh_region_select(edit, mesh, view, region, sel_op) {
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
      candidates.push([v, !!p && region.point(p) && visible(co(v))]);
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
    // Box and lasso: edges fully inside first; only when there are none, edges that cross the region.
    const selected = was('.select_edge');
    if (!region.edgesInsideFirst || !apply(BM_EDGE, actions(selected, edges.map(([e, a, b, vis]) => [e, vis && region.point(a) && region.point(b)])))) {
      apply(BM_EDGE, actions(selected, edges.map(([e, a, b, vis]) => [e, vis && region.edge(a, b)])));
    }
  }
  if (selectmode & SCE_SELECT_FACE) {
    const hidden = mesh.attribute('.hide_poly'), candidates = [];
    for (let f = 0; f < mesh.faces_num; f++) {
      if (hidden[f]) continue;
      const start = mesh.face_offsets[f], end = mesh.face_offsets[f + 1], center = [0, 0, 0];
      for (let c = start; c < end; c++) for (let k = 0; k < 3; k++) center[k] += co(mesh.corner_verts[c])[k] / (end - start);
      const p = view.project(center);
      candidates.push([f, !!p && region.point(p) && visible(center)]);
    }
    apply(BM_FACE, actions(was('.select_poly'), candidates));
  }
  if (changed) edit.selectFlush();
  return changed;
}

