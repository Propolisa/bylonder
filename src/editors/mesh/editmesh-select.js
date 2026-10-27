// Edit Mode selection (editmesh_select.cc): finding the element under the mouse in the edit mesh's Mesh arrays, as
// Blender finds it in the coordinates it draws, and selecting it in the edit mesh (an EditMesh). Elements are indices.
// `view` projects Blender-axis local coordinates to screen pixels and tells whether a point is hidden behind the
// mesh: { project(co) -> [x, y, depth] | null, occluded(co) -> bool, faceAt(x, y) -> face | -1, xray }.
import { BM_VERT, BM_EDGE, BM_FACE } from '../../bmesh/intern/bmesh-class.js';
import { SCE_SELECT_VERTEX, SCE_SELECT_EDGE, SCE_SELECT_FACE } from '../../bmesh/intern/bmesh-marking.js';
import { SEL_OP_SET, SEL_OP_XOR } from '../space_view3d/view3d-select.js';

// ED_view3d_select_dist_px.
export const SELECT_DIST_PX = 75;
// Elements already selected count this much farther, so clicking again cycles to the next one (use_select_bias).
const SELECT_BIAS_PX = 5;

const co = (mesh, v) => mesh.vert_positions.subarray(v * 3, v * 3 + 3);

export function EDBM_vert_find_nearest(mesh, view, mouse, dist = SELECT_DIST_PX) {
  const selected = mesh.attribute('.select_vert'), hidden = mesh.attribute('.hide_vert');
  let best = -1;
  for (let v = 0; v < mesh.verts_num; v++) {
    if (hidden[v]) continue;
    const p = view.project(co(mesh, v));
    if (!p) continue;
    const d = Math.hypot(p[0] - mouse[0], p[1] - mouse[1]) + (selected[v] ? SELECT_BIAS_PX : 0);
    if (d < dist && (view.xray || !view.occluded(co(mesh, v)))) { dist = d; best = v; }
  }
  return best;
}

function segmentDistance(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len)) : 0;
  return [Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy), t];
}

export function EDBM_edge_find_nearest(mesh, view, mouse, dist = SELECT_DIST_PX, use_select_bias = true) {
  const selected = mesh.attribute('.select_edge'), hidden = mesh.attribute('.hide_edge');
  let best = -1;
  for (let e = 0; e < mesh.edges_num; e++) {
    if (hidden[e]) continue;
    const c1 = co(mesh, mesh.edges[e * 2]), c2 = co(mesh, mesh.edges[e * 2 + 1]);
    const a = view.project(c1), b = view.project(c2);
    if (!a || !b) continue;
    const [d0, t] = segmentDistance(mouse, a, b);
    const d = d0 + (use_select_bias && selected[e] ? SELECT_BIAS_PX : 0);
    if (d >= dist) continue;
    const mid = [0, 1, 2].map((i) => c1[i] + (c2[i] - c1[i]) * t);
    if (view.xray || !view.occluded(mid)) { dist = d; best = e; }
  }
  return best;
}

// In solid shading the face under the mouse; in X-ray the face whose center is nearest.
export function EDBM_face_find_nearest(mesh, view, mouse, dist = SELECT_DIST_PX) {
  if (!view.xray) return view.faceAt(mouse[0], mouse[1]);
  const hidden = mesh.attribute('.hide_poly');
  let best = -1;
  for (let f = 0; f < mesh.faces_num; f++) {
    if (hidden[f]) continue;
    const start = mesh.face_offsets[f], end = mesh.face_offsets[f + 1], center = [0, 0, 0];
    for (let c = start; c < end; c++) for (let i = 0; i < 3; i++) center[i] += co(mesh, mesh.corner_verts[c])[i] / (end - start);
    const p = view.project(center);
    if (!p) continue;
    const d = Math.hypot(p[0] - mouse[0], p[1] - mouse[1]);
    if (d < dist) { dist = d; best = f; }
  }
  return best;
}

const MODES = [[SCE_SELECT_VERTEX, BM_VERT, EDBM_vert_find_nearest], [SCE_SELECT_EDGE, BM_EDGE, EDBM_edge_find_nearest], [SCE_SELECT_FACE, BM_FACE, EDBM_face_find_nearest]];

// The nearest element in the enabled select modes: { htype, index } or null.
export function EDBM_unified_findnearest(mesh, view, mouse, selectmode) {
  for (const [mode, htype, find] of MODES) {
    if (!(selectmode & mode)) continue;
    const index = find(mesh, view, mouse);
    if (index >= 0) return { htype, index };
  }
  return null;
}

// view3d.select in Edit Mode with Blender's left-click keymap: a click selects only the element under the mouse
// (or deselects all over empty space); Shift toggles it.
export function EDBM_select_pick(edit, mesh, view, mouse, { toggle = false, deselect_all = true } = {}) {
  const hit = EDBM_unified_findnearest(mesh, view, mouse, edit.selectmode);
  return edit.selectPick(hit?.htype ?? 0, hit?.index ?? -1, toggle ? SEL_OP_XOR : SEL_OP_SET, deselect_all);
}

// mesh.select_linked_pick's index of an element: verts, then edges, then faces (EDBM_elem_to_index_any).
export function EDBM_elem_to_index_any(mesh, { htype, index }) {
  return htype === BM_VERT ? index : htype === BM_EDGE ? mesh.verts_num + index : mesh.verts_num + mesh.edges_num + index;
}
