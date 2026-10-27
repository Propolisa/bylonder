// Edit Mode selection (editmesh_select.cc): finding the element under the mouse and the select operators.
// `view` projects Blender-axis local coordinates to screen pixels and tells whether a point is hidden behind the
// mesh: { project(co) -> [x, y, depth] | null, occluded(co) -> bool, faceAt(x, y) -> face | -1, xray }.
import { BMW_edgeloop, BMW_edgering, BMW_faceloop, BMW_edgeboundary, BMW_island, BMW_vert_shell, BMW_loop_shell_wire } from '../../bmesh/intern/bmesh-walkers.js';
import { BM_edge_is_boundary, BM_edge_is_contiguous, BM_FACES_OF_EDGE } from '../../bmesh/intern/bmesh-query.js';
import { BM_ITER_MESH, BM_VERT, BM_EDGE, BM_FACE, BM_ELEM_SELECT, BM_ELEM_HIDDEN, BM_ELEM_SEAM, BM_ELEM_SMOOTH, BM_elem_flag_test, BM_elem_flag_test_bool, BMO_flag_test, BMO_flag_enable } from '../../bmesh/intern/bmesh-class.js';
import { bmo_call } from '../../bmesh/intern/bmesh-operators.js';
import {
  SCE_SELECT_VERTEX, SCE_SELECT_EDGE, SCE_SELECT_FACE, BM_elem_select_set, BM_mesh_select_mode_flush, BM_mesh_select_mode_set,
  BM_mesh_elem_hflag_disable_all, BM_mesh_elem_hflag_enable_all, BM_select_history_store, BM_select_history_remove,
  BM_select_history_active_get, BM_select_history_clear, BM_vert_select_set, BM_edge_select_set, BM_face_select_set, BM_mesh_select_mode_flush_ex,
} from '../../bmesh/intern/bmesh-marking.js';

// ED_view3d_select_dist_px.
export const SELECT_DIST_PX = 75;
// Elements already selected count this much farther, so clicking again cycles to the next one (use_select_bias).
const SELECT_BIAS_PX = 5;

const co = (bm, v) => bm.v.co.subarray(v * 3, v * 3 + 3);
const visible = (pool, i) => !BM_elem_flag_test(pool, i, BM_ELEM_HIDDEN);

export function EDBM_vert_find_nearest(bm, view, mouse, dist = SELECT_DIST_PX) {
  let best = -1;
  BM_ITER_MESH(bm.v, (v) => {
    if (!visible(bm.v, v)) return;
    const p = view.project(co(bm, v));
    if (!p) return;
    const d = Math.hypot(p[0] - mouse[0], p[1] - mouse[1]) + (BM_elem_flag_test(bm.v, v, BM_ELEM_SELECT) ? SELECT_BIAS_PX : 0);
    if (d < dist && (view.xray || !view.occluded(co(bm, v)))) { dist = d; best = v; }
  });
  return best;
}

function segmentDistance(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len)) : 0;
  return [Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy), t];
}

export function EDBM_edge_find_nearest(bm, view, mouse, dist = SELECT_DIST_PX, use_select_bias = true) {
  let best = -1;
  BM_ITER_MESH(bm.e, (e) => {
    if (!visible(bm.e, e)) return;
    const a = view.project(co(bm, bm.e.v1[e])), b = view.project(co(bm, bm.e.v2[e]));
    if (!a || !b) return;
    const [d0, t] = segmentDistance(mouse, a, b);
    const d = d0 + (use_select_bias && BM_elem_flag_test(bm.e, e, BM_ELEM_SELECT) ? SELECT_BIAS_PX : 0);
    if (d >= dist) return;
    const c1 = co(bm, bm.e.v1[e]), c2 = co(bm, bm.e.v2[e]);
    const mid = [0, 1, 2].map((i) => c1[i] + (c2[i] - c1[i]) * t);
    if (view.xray || !view.occluded(mid)) { dist = d; best = e; }
  });
  return best;
}

// In solid shading the face under the mouse; in X-ray the face whose center is nearest.
export function EDBM_face_find_nearest(bm, view, mouse, dist = SELECT_DIST_PX) {
  if (!view.xray) return view.faceAt(mouse[0], mouse[1]);
  let best = -1;
  BM_ITER_MESH(bm.f, (f) => {
    if (!visible(bm.f, f)) return;
    const center = [0, 0, 0];
    let l = bm.f.l_first[f];
    do for (let i = 0; i < 3; i++) center[i] += bm.v.co[bm.l.v[l] * 3 + i] / bm.f.len[f]; while ((l = bm.l.next[l]) !== bm.f.l_first[f]);
    const p = view.project(center);
    if (!p) return;
    const d = Math.hypot(p[0] - mouse[0], p[1] - mouse[1]);
    if (d < dist) { dist = d; best = f; }
  });
  return best;
}

const MODES = [[SCE_SELECT_VERTEX, BM_VERT, EDBM_vert_find_nearest], [SCE_SELECT_EDGE, BM_EDGE, EDBM_edge_find_nearest], [SCE_SELECT_FACE, BM_FACE, EDBM_face_find_nearest]];

// The nearest element in the enabled select modes: { htype, ele } or null.
export function EDBM_unified_findnearest(bm, view, mouse) {
  for (const [mode, htype, find] of MODES) {
    if (!(bm.selectmode & mode)) continue;
    const ele = find(bm, view, mouse);
    if (ele >= 0) return { htype, ele };
  }
  return null;
}

// view3d.select in Edit Mode with Blender's left-click keymap: a click selects only the element under the mouse
// (or deselects all over empty space); Shift toggles, making a selected element active first.
export function EDBM_select_pick(bm, view, mouse, { toggle = false, deselect_all = true } = {}) {
  const hit = EDBM_unified_findnearest(bm, view, mouse);
  if (!hit) {
    if (deselect_all) BM_mesh_elem_hflag_disable_all(bm, BM_VERT | BM_EDGE | BM_FACE, BM_ELEM_SELECT);
    return deselect_all;
  }
  const pool = { [BM_VERT]: bm.v, [BM_EDGE]: bm.e, [BM_FACE]: bm.f }[hit.htype];
  const selected = BM_elem_flag_test(pool, hit.ele, BM_ELEM_SELECT);
  const active = BM_select_history_active_get(bm);
  if (toggle) {
    if (selected && active?.htype === hit.htype && active.ele === hit.ele) {
      BM_select_history_remove(bm, hit.htype, hit.ele);
      BM_elem_select_set(bm, hit.htype, hit.ele, false);
    } else {
      BM_select_history_store(bm, hit.htype, hit.ele);
      BM_elem_select_set(bm, hit.htype, hit.ele, true);
    }
  } else {
    BM_mesh_elem_hflag_disable_all(bm, BM_VERT | BM_EDGE | BM_FACE, BM_ELEM_SELECT);
    BM_select_history_store(bm, hit.htype, hit.ele);
    BM_elem_select_set(bm, hit.htype, hit.ele, true);
  }
  if (hit.htype === BM_FACE) bm.act_face = hit.ele;
  BM_mesh_select_mode_flush(bm);
  return true;
}

// mesh.select_all: SELECT, DESELECT, INVERT or TOGGLE.
export function mesh_select_all(bm, action) {
  const all = BM_VERT | BM_EDGE | BM_FACE;
  if (action === 'TOGGLE') action = bm.totvertsel || bm.totedgesel || bm.totfacesel ? 'DESELECT' : 'SELECT';
  if (action === 'SELECT') BM_mesh_elem_hflag_enable_all(bm, all, BM_ELEM_SELECT, true);
  else if (action === 'DESELECT') BM_mesh_elem_hflag_disable_all(bm, all, BM_ELEM_SELECT);
  else {
    // EDBM_select_swap: invert the elements of the lowest enabled mode, then flush.
    const [pool, htype] = bm.selectmode & SCE_SELECT_VERTEX ? ['v', BM_VERT] : bm.selectmode & SCE_SELECT_EDGE ? ['e', BM_EDGE] : ['f', BM_FACE];
    const was = [];
    BM_ITER_MESH(bm[pool], (i) => { if (visible(bm[pool], i)) was.push([i, BM_elem_flag_test(bm[pool], i, BM_ELEM_SELECT)]); });
    BM_mesh_elem_hflag_disable_all(bm, all, BM_ELEM_SELECT);
    for (const [i, on] of was) if (!on) BM_elem_select_set(bm, htype, i, true);
    BM_select_history_clear(bm);
  }
  BM_mesh_select_mode_flush(bm);
}

// mesh.select_mode: switch to one mode, or with use_extend add or remove it from the enabled modes.
export function mesh_select_mode(bm, type, { use_extend = false } = {}) {
  const mode = { VERT: SCE_SELECT_VERTEX, EDGE: SCE_SELECT_EDGE, FACE: SCE_SELECT_FACE }[type];
  const next = use_extend ? bm.selectmode ^ mode || mode : mode;
  BM_mesh_select_mode_set(bm, next);
  return next;
}

// mesh.loop_select (Alt click): the edge loop through `eed`, or in face select mode the face loop across it. A
// boundary loop that is already selected grows to the whole boundary. `extend`, `deselect` and `toggle` as in
// Blender's keymap (Shift Alt toggles).
export function edbm_select_loop(bm, eed, { extend = false, deselect = false, toggle = false, ring = false } = {}) {
  let select = true, select_clear = false, select_cycle = true;
  if (!extend && !deselect && !toggle) select_clear = true;
  if (extend) select = true;
  else if (deselect) select = false;
  else if (select_clear || !BM_elem_flag_test(bm.e, eed, BM_ELEM_SELECT)) select = true;
  else if (toggle) { select = false; select_cycle = false; }

  const walkSelect = (htype, elems) => elems.forEach((ele) => { if (!select) BM_select_history_remove(bm, htype, ele); BM_elem_select_set(bm, htype, ele, select); });
  if (bm.selectmode & SCE_SELECT_FACE) {
    if (select_clear) BM_mesh_elem_hflag_disable_all(bm, BM_VERT | BM_EDGE | BM_FACE, BM_ELEM_SELECT);
    walkSelect(BM_FACE, BMW_faceloop(bm, eed));
  } else if (ring) {
    if (select_clear) BM_mesh_elem_hflag_disable_all(bm, BM_VERT | BM_EDGE | BM_FACE, BM_ELEM_SELECT);
    walkSelect(BM_EDGE, BMW_edgering(bm, eed));
  } else {
    const delimit = { outer_corners: true, ngons: true };
    let full_boundary = false;
    if (select_cycle && BM_edge_is_boundary(bm, eed)) {
      const counts = (edges) => edges.filter((e) => BM_elem_flag_test_bool(bm.e, e, BM_ELEM_SELECT) !== select).length;
      if (counts(BMW_edgeloop(bm, eed, delimit)) === 0) full_boundary = counts(BMW_edgeboundary(bm, eed)) !== 0;
    }
    if (select_clear) BM_mesh_elem_hflag_disable_all(bm, BM_VERT | BM_EDGE | BM_FACE, BM_ELEM_SELECT);
    walkSelect(BM_EDGE, full_boundary ? BMW_edgeboundary(bm, eed) : BMW_edgeloop(bm, eed, delimit));
  }
  BM_mesh_select_mode_flush(bm);
  if (select && bm.selectmode & SCE_SELECT_EDGE) BM_select_history_store(bm, BM_EDGE, eed);
}

// select_linked_delimit_test: whether an edge stops the linked walk.
const DELIMITS = {
  SEAM: (bm, e) => BM_elem_flag_test(bm.e, e, BM_ELEM_SEAM),
  SHARP: (bm, e) => !BM_elem_flag_test(bm.e, e, BM_ELEM_SMOOTH),
  NORMAL: (bm, e) => !BM_edge_is_contiguous(bm, e),
  MATERIAL: (bm, e) => new Set(BM_FACES_OF_EDGE(bm, e).map((f) => bm.f.mat_nr[f])).size > 1,
};
const BMO_ELE_TAG = 1;
// USE_LINKED_SELECT_DEFAULT_HACK: without a delimit given, faces stop at seams and verts and edges do not.
const delimitDefault = (selectmode, delimit) => delimit ?? (selectmode & (SCE_SELECT_VERTEX | SCE_SELECT_EDGE) ? [] : ['SEAM']);

// select_linked_delimit_begin: tags the edges the walk may cross. Runs `fn` inside its own tool flag layer.
function withDelimit(bm, delimit, fn) {
  const tests = delimit.map((d) => DELIMITS[d]).filter(Boolean);
  return bmo_call(bm, () => {
    if (tests.length) BM_ITER_MESH(bm.e, (e) => { if (!tests.some((test) => test(bm, e))) BMO_flag_enable(bm.e, e, BMO_ELE_TAG); });
    return fn(tests.length ? BMO_ELE_TAG : 0);
  });
}

// The selection a linked walk from a vert or edge gives: delimited walks select the verts (or edges) of the loops
// they reach and the wire edges, plain walks every connected edge.
function selectLinkedFrom(bm, htype, ele, select, mask_edge) {
  const walk = { htype: htype === BM_VERT ? 'v' : 'e', mask_edge, test_hidden: true };
  if (!mask_edge) return BMW_vert_shell(bm, ele, walk).forEach((e) => BM_edge_select_set(bm, e, select));
  const { loops, edges } = BMW_loop_shell_wire(bm, ele, walk);
  for (const l of loops) htype === BM_VERT ? BM_vert_select_set(bm, bm.l.v[l], select) : BM_edge_select_set(bm, bm.l.e[l], select);
  for (const e of edges) BM_edge_select_set(bm, e, select);
}

// mesh.select_linked: everything connected to the selection, stopping at the `delimit` edges.
export function edbm_select_linked_exec(bm, { delimit } = {}) {
  delimit = delimitDefault(bm.selectmode, delimit);
  withDelimit(bm, delimit, (mask_edge) => {
    const tagged = (pool, list) => { const out = []; BM_ITER_MESH(bm[pool], (i) => { if (list(i)) out.push(i); }); return out; };
    const selected = (pool) => (i) => BM_elem_flag_test(bm[pool], i, BM_ELEM_SELECT);
    if (bm.selectmode & SCE_SELECT_VERTEX) {
      const start = new Set(tagged('v', selected('v')));
      // Delimited edges next to selected faces leave their verts out, so isolated verts can still step off.
      if (mask_edge) BM_ITER_MESH(bm.e, (e) => { if (!BMO_flag_test(bm.e, e, mask_edge) && BM_FACES_OF_EDGE(bm, e).some(selected('f'))) { start.delete(bm.e.v1[e]); start.delete(bm.e.v2[e]); } });
      BM_ITER_MESH(bm.v, (v) => {
        if (!start.has(v)) return;
        if (mask_edge) {
          const { loops, edges } = BMW_loop_shell_wire(bm, v, { mask_edge, test_hidden: true });
          for (const l of loops) { BM_vert_select_set(bm, bm.l.v[l], true); start.delete(bm.l.v[l]); }
          for (const e of edges) { BM_edge_select_set(bm, e, true); start.delete(bm.e.v1[e]); start.delete(bm.e.v2[e]); }
        } else for (const e of BMW_vert_shell(bm, v, { test_hidden: true })) BM_edge_select_set(bm, e, true);
      });
      BM_mesh_select_mode_flush_ex(bm, bm.selectmode);
    } else if (bm.selectmode & SCE_SELECT_EDGE) {
      const start = new Set(tagged('e', (e) => selected('e')(e) && (!mask_edge || BMO_flag_test(bm.e, e, mask_edge) || !BM_FACES_OF_EDGE(bm, e).some(selected('f')))));
      BM_ITER_MESH(bm.e, (e) => {
        if (!start.has(e)) return;
        if (mask_edge) {
          const { loops, edges } = BMW_loop_shell_wire(bm, e, { htype: 'e', mask_edge, test_hidden: true });
          for (const l of loops) { BM_edge_select_set(bm, bm.l.e[l], true); BM_edge_select_set(bm, bm.l.e[bm.l.prev[l]], true); start.delete(bm.l.e[l]); }
          for (const w of edges) { BM_edge_select_set(bm, w, true); start.delete(w); }
        } else for (const w of BMW_vert_shell(bm, e, { htype: 'e', test_hidden: true })) BM_edge_select_set(bm, w, true);
      });
      BM_mesh_select_mode_flush_ex(bm, bm.selectmode);
    } else {
      const start = new Set(tagged('f', selected('f')));
      BM_ITER_MESH(bm.f, (f) => {
        if (!start.has(f)) return;
        for (const w of BMW_island(bm, f, { mask_edge, test_hidden: true })) { BM_face_select_set(bm, w, true); start.delete(w); }
      });
    }
  });
}

// mesh.select_linked_pick: everything connected to the element under the mouse, or with `deselect` deselected.
export function edbm_select_linked_pick(bm, view, mouse, { deselect = false, delimit } = {}) {
  if (!bm.e.size) return false;
  const hit = EDBM_unified_findnearest(bm, view, mouse);
  if (!hit) return false;
  delimit = delimitDefault(bm.selectmode, delimit);
  withDelimit(bm, delimit, (mask_edge) => {
    if (hit.htype === BM_FACE) for (const f of BMW_island(bm, hit.ele, { mask_edge, test_hidden: true })) BM_face_select_set(bm, f, !deselect);
    else {
      selectLinkedFrom(bm, hit.htype, hit.ele, !deselect, mask_edge);
      BM_mesh_select_mode_flush_ex(bm, bm.selectmode);
    }
  });
  return true;
}
