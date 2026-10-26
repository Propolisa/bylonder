// Selection and hiding (bmesh_marking.cc). Selection counts live on the BMesh as totvertsel and friends.
import { BM_ITER_MESH, BM_ELEM_SELECT, BM_ELEM_HIDDEN, BM_elem_flag_test, BM_elem_flag_enable, BM_elem_flag_disable, BM_VERT, BM_EDGE, BM_FACE } from './bmesh-class.js';
import { bmesh_disk_edge_next } from './bmesh-structure.js';

export const SCE_SELECT_VERTEX = 1, SCE_SELECT_EDGE = 2, SCE_SELECT_FACE = 4;
const POOL = { [BM_VERT]: 'v', [BM_EDGE]: 'e', [BM_FACE]: 'f' };
const loopsOf = (bm, f, fn) => { const first = bm.f.l_first[f]; let l = first; do fn(l); while ((l = bm.l.next[l]) !== first); };

function recount(bm) {
  for (const [name, total] of [['v', 'totvertsel'], ['e', 'totedgesel'], ['f', 'totfacesel']]) {
    let n = 0;
    BM_ITER_MESH(bm[name], (i) => { if (BM_elem_flag_test(bm[name], i, BM_ELEM_SELECT)) n++; });
    bm[total] = n;
  }
}

function selectFlag(bm, name, total, i, select) {
  const pool = bm[name];
  if (BM_elem_flag_test(pool, i, BM_ELEM_HIDDEN)) return;
  if (select && !BM_elem_flag_test(pool, i, BM_ELEM_SELECT)) { BM_elem_flag_enable(pool, i, BM_ELEM_SELECT); bm[total] = (bm[total] ?? 0) + 1; }
  else if (!select && BM_elem_flag_test(pool, i, BM_ELEM_SELECT)) { BM_elem_flag_disable(pool, i, BM_ELEM_SELECT); bm[total] = (bm[total] ?? 0) - 1; }
}

export const BM_vert_select_set = (bm, v, select) => selectFlag(bm, 'v', 'totvertsel', v, select);
export const BM_edge_select_set_noflush = (bm, e, select) => selectFlag(bm, 'e', 'totedgesel', e, select);
export const BM_face_select_set_noflush = (bm, f, select) => selectFlag(bm, 'f', 'totfacesel', f, select);

function bm_vert_is_edge_select_any_other(bm, v, e_first) {
  let e = e_first;
  while ((e = bmesh_disk_edge_next(bm, e, v)) !== e_first) if (BM_elem_flag_test(bm.e, e, BM_ELEM_SELECT)) return true;
  return false;
}

function bm_edge_is_face_select_any_other(bm, l_first) {
  let l = l_first;
  while ((l = bm.l.radial_next[l]) !== l_first) if (BM_elem_flag_test(bm.f, bm.l.f[l], BM_ELEM_SELECT)) return true;
  return false;
}

export function BM_edge_select_set(bm, e, select) {
  if (BM_elem_flag_test(bm.e, e, BM_ELEM_HIDDEN)) return;
  BM_edge_select_set_noflush(bm, e, select);
  for (const v of [bm.e.v1[e], bm.e.v2[e]]) {
    if (select || bm.selectmode & SCE_SELECT_VERTEX || !bm_vert_is_edge_select_any_other(bm, v, e)) BM_vert_select_set(bm, v, select);
  }
}

export function BM_face_select_set(bm, f, select) {
  if (BM_elem_flag_test(bm.f, f, BM_ELEM_HIDDEN)) return;
  BM_face_select_set_noflush(bm, f, select);
  const { l } = bm;
  if (select) {
    loopsOf(bm, f, (lp) => { BM_vert_select_set(bm, l.v[lp], true); BM_edge_select_set(bm, l.e[lp], true); });
  } else if (bm.selectmode & SCE_SELECT_VERTEX) {
    loopsOf(bm, f, (lp) => { BM_vert_select_set(bm, l.v[lp], false); BM_edge_select_set_noflush(bm, l.e[lp], false); });
  } else {
    loopsOf(bm, f, (lp) => {
      if (bm.selectmode & SCE_SELECT_EDGE || !bm_edge_is_face_select_any_other(bm, lp)) BM_edge_select_set_noflush(bm, l.e[lp], false);
    });
    loopsOf(bm, f, (lp) => { if (!bm_vert_is_edge_select_any_other(bm, l.v[lp], l.e[lp])) BM_vert_select_set(bm, l.v[lp], false); });
  }
}

export function BM_elem_select_set(bm, htype, ele, select) {
  if (htype === BM_VERT) BM_vert_select_set(bm, ele, select);
  else if (htype === BM_EDGE) BM_edge_select_set(bm, ele, select);
  else BM_face_select_set(bm, ele, select);
}

// Flush up: edges from verts in vertex mode, faces from edges in vertex and edge mode.
export function BM_mesh_select_mode_flush_ex(bm, selectmode) {
  const sel = (pool, i) => BM_elem_flag_test(pool, i, BM_ELEM_SELECT);
  if (selectmode & SCE_SELECT_VERTEX) {
    BM_ITER_MESH(bm.e, (e) => {
      const on = !BM_elem_flag_test(bm.e, e, BM_ELEM_HIDDEN) && sel(bm.v, bm.e.v1[e]) && sel(bm.v, bm.e.v2[e]);
      (on ? BM_elem_flag_enable : BM_elem_flag_disable)(bm.e, e, BM_ELEM_SELECT);
    });
  }
  if (selectmode & (SCE_SELECT_VERTEX | SCE_SELECT_EDGE)) {
    BM_ITER_MESH(bm.f, (f) => {
      let ok = !BM_elem_flag_test(bm.f, f, BM_ELEM_HIDDEN);
      if (ok) loopsOf(bm, f, (lp) => { if (!sel(bm.e, bm.l.e[lp])) ok = false; });
      (ok ? BM_elem_flag_enable : BM_elem_flag_disable)(bm.f, f, BM_ELEM_SELECT);
    });
  }
  BM_select_history_validate(bm);
  recount(bm);
}
export const BM_mesh_select_mode_flush = (bm) => BM_mesh_select_mode_flush_ex(bm, bm.selectmode);

export function BM_mesh_select_mode_set(bm, selectmode) {
  bm.selectmode = selectmode;
  if (selectmode & SCE_SELECT_EDGE && !(selectmode & SCE_SELECT_VERTEX)) {
    BM_ITER_MESH(bm.e, (e) => { if (BM_elem_flag_test(bm.e, e, BM_ELEM_SELECT)) BM_edge_select_set(bm, e, true); });
  } else if (selectmode & SCE_SELECT_FACE && !(selectmode & (SCE_SELECT_VERTEX | SCE_SELECT_EDGE))) {
    BM_ITER_MESH(bm.f, (f) => { if (BM_elem_flag_test(bm.f, f, BM_ELEM_SELECT)) BM_face_select_set(bm, f, true); });
  }
  BM_mesh_select_mode_flush(bm);
}

// BM_mesh_elem_hflag_enable_all / disable_all for any of BM_VERT | BM_EDGE | BM_FACE.
export function BM_mesh_elem_hflag_disable_all(bm, htype, hflag, respecthide = false) {
  for (const type of [BM_VERT, BM_EDGE, BM_FACE]) {
    if (!(htype & type)) continue;
    const pool = bm[POOL[type]];
    BM_ITER_MESH(pool, (i) => { if (!(respecthide && BM_elem_flag_test(pool, i, BM_ELEM_HIDDEN))) BM_elem_flag_disable(pool, i, hflag); });
  }
  if (hflag & BM_ELEM_SELECT) { BM_select_history_clear(bm); recount(bm); }
}
export function BM_mesh_elem_hflag_enable_all(bm, htype, hflag, respecthide = false) {
  for (const type of [BM_VERT, BM_EDGE, BM_FACE]) {
    if (!(htype & type)) continue;
    const pool = bm[POOL[type]];
    BM_ITER_MESH(pool, (i) => { if (!(respecthide && BM_elem_flag_test(pool, i, BM_ELEM_HIDDEN))) BM_elem_flag_enable(pool, i, hflag); });
  }
  if (hflag & BM_ELEM_SELECT) recount(bm);
}

// Select history (BMEditSelection list): [{ htype, ele }], last is the active element.
export const BM_select_history_clear = (bm) => { bm.selected = []; };
export function BM_select_history_remove(bm, htype, ele) {
  bm.selected = (bm.selected ?? []).filter((s) => !(s.htype === htype && s.ele === ele));
}
export function BM_select_history_store(bm, htype, ele) {
  BM_select_history_remove(bm, htype, ele);
  bm.selected.push({ htype, ele });
}
export function BM_select_history_validate(bm) {
  bm.selected = (bm.selected ?? []).filter(({ htype, ele }) => bm[POOL[htype]].alive[ele] && BM_elem_flag_test(bm[POOL[htype]], ele, BM_ELEM_SELECT));
}
export const BM_select_history_active_get = (bm) => bm.selected?.at(-1) ?? null;

// Hiding (BM_*_hide_set): hiding a vert hides its edges and faces, hiding an edge its faces; verts and edges stay
// visible while anything visible uses them.
const setHidden = (pool, i, hide) => (hide ? BM_elem_flag_enable : BM_elem_flag_disable)(pool, i, BM_ELEM_HIDDEN);
function bm_vert_is_edge_visible_any(bm, v) {
  const first = bm.v.e[v];
  if (first < 0) return false;
  let e = first;
  do if (!BM_elem_flag_test(bm.e, e, BM_ELEM_HIDDEN)) return true; while ((e = bmesh_disk_edge_next(bm, e, v)) !== first);
  return false;
}
function bm_edge_is_face_visible_any(bm, e) {
  const first = bm.e.l[e];
  if (first < 0) return false;
  let l = first;
  do if (!BM_elem_flag_test(bm.f, bm.l.f[l], BM_ELEM_HIDDEN)) return true; while ((l = bm.l.radial_next[l]) !== first);
  return false;
}
const vert_flush_hide_set = (bm, v) => setHidden(bm.v, v, !bm_vert_is_edge_visible_any(bm, v));
const edge_flush_hide_set = (bm, e) => setHidden(bm.e, e, !bm_edge_is_face_visible_any(bm, e));
const radialFaces = (bm, e, fn) => { const first = bm.e.l[e]; if (first < 0) return; let l = first; do fn(bm.l.f[l]); while ((l = bm.l.radial_next[l]) !== first); };

export function BM_vert_hide_set(bm, v, hide) {
  setHidden(bm.v, v, hide);
  const first = bm.v.e[v];
  if (first < 0) return;
  let e = first;
  do { setHidden(bm.e, e, hide); radialFaces(bm, e, (f) => setHidden(bm.f, f, hide)); } while ((e = bmesh_disk_edge_next(bm, e, v)) !== first);
}

export function BM_edge_hide_set(bm, e, hide) {
  radialFaces(bm, e, (f) => setHidden(bm.f, f, hide));
  setHidden(bm.e, e, hide);
  for (const v of [bm.e.v1[e], bm.e.v2[e]]) hide ? vert_flush_hide_set(bm, v) : setHidden(bm.v, v, false);
}

export function BM_face_hide_set(bm, f, hide) {
  setHidden(bm.f, f, hide);
  if (hide) {
    loopsOf(bm, f, (l) => edge_flush_hide_set(bm, bm.l.e[l]));
    loopsOf(bm, f, (l) => vert_flush_hide_set(bm, bm.l.v[l]));
  } else {
    loopsOf(bm, f, (l) => { setHidden(bm.e, bm.l.e[l], false); setHidden(bm.v, bm.l.v[l], false); });
  }
}

// BM_elem_hide_set: deselects before hiding.
export function BM_elem_hide_set(bm, htype, ele, hide) {
  if (hide) BM_elem_select_set(bm, htype, ele, false);
  ({ [BM_VERT]: BM_vert_hide_set, [BM_EDGE]: BM_edge_hide_set, [BM_FACE]: BM_face_hide_set })[htype](bm, ele, hide);
}
