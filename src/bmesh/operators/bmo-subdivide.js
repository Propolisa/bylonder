// Edge subdivision by face patterns (bmo_subdivide.cc). Smoothness and fractal displacement are not ported yet;
// `use_sphere` (for primitives) is.
import { BM_ITER_MESH, BM_VERT, BM_EDGE, BM_FACE, BM_ELEM_SELECT, BMO_flag_test, BMO_flag_enable } from '../intern/bmesh-class.js';
import { BM_edge_split, BM_face_split } from '../intern/bmesh-mods.js';
import { BM_vert_pair_share_face_by_len, BM_edge_share_vert_check, BM_vert_in_face, BM_ITER_LOOPS_OF_VERT } from '../intern/bmesh-query.js';
import { BMO_op_callf } from '../intern/bmesh-operators.js';
import { BM_elem_select_set, BM_mesh_elem_hflag_disable_all, BM_mesh_select_flush_from_verts } from '../intern/bmesh-marking.js';

export const SUBD_CORNER_INNERVERT = 0, SUBD_CORNER_PATH = 1, SUBD_CORNER_FAN = 2, SUBD_CORNER_STRAIGHT_CUT = 3;
export const SUBDIV_SELECT_NONE = 0, SUBDIV_SELECT_ORIG = 1, SUBDIV_SELECT_INNER = 2, SUBDIV_SELECT_LOOPCUT = 3;
const SUBD_SPLIT = 1, EDGE_PERCENT = 2, ELE_INNER = 8, ELE_SPLIT = 16;
// Face splits at a little under 1 degree (#32665).
const FLT_FACE_SPLIT_EPSILON = 0.00005;

const faceLoops = (bm, f) => { const out = [], first = bm.f.l_first[f]; let l = first; do out.push(l); while ((l = bm.l.next[l]) !== first); return out; };

function connect_smallest_face(bm, v_a, v_b) {
  const shared = BM_vert_pair_share_face_by_len(bm, v_a, v_b, true);
  if (!shared) return [-1, -1];
  const split = BM_face_split(bm, shared[0], shared[1], shared[2]);
  return split ? [bm.l.e[split[1]], split[0]] : [-1, -1];
}

// alter_co: the displaced position of `v` goes to the temporary positions `p.tmp`, applied after all splits.
function alter_co(bm, v, p) {
  const co = Array.from(bm.v.co.subarray(v * 3, v * 3 + 3));
  if (p.use_sphere) {
    const len = Math.hypot(...co);
    if (len) for (let a = 0; a < 3; a++) co[a] *= p.smooth / len;
  }
  p.tmp.set(v, co);
}

function bm_subdivide_edge_addvert(bm, edge, p, factor_edge_split, factor_subd, v_a, v_b) {
  const [v_new, e_new] = BM_edge_split(bm, edge, bm.e.v1[edge], factor_edge_split);
  BMO_flag_enable(bm.v, v_new, ELE_INNER);
  alter_co(bm, v_new, p);
  const no = bm.v.no;
  let len = 0;
  for (let a = 0; a < 3; a++) { no[v_new * 3 + a] = no[v_a * 3 + a] + (no[v_b * 3 + a] - no[v_a * 3 + a]) * factor_subd; len += no[v_new * 3 + a] ** 2; }
  if (len) for (let a = 0; a < 3; a++) no[v_new * 3 + a] /= Math.sqrt(len);
  return [v_new, e_new];
}

function subdivide_edge_num(bm, edge, curpoint, totpoint, p, v_a, v_b) {
  const percent = BMO_flag_test(bm.e, edge, EDGE_PERCENT) && totpoint === 1;
  return bm_subdivide_edge_addvert(bm, edge, p, percent ? p.edge_percents.get(edge) : 1 / (totpoint + 1 - curpoint), percent ? 0 : (curpoint + 1) / (totpoint + 1), v_a, v_b);
}

function bm_subdivide_multicut(bm, edge, p, v_a, v_b) {
  const v1 = bm.e.v1[edge], v2 = bm.e.v2[edge];
  for (let i = 0; i < p.numcuts; i++) {
    const [v, e_new] = subdivide_edge_num(bm, edge, i, p.numcuts, p, v_a, v_b);
    BMO_flag_enable(bm.v, v, SUBD_SPLIT | ELE_SPLIT);
    BMO_flag_enable(bm.e, edge, SUBD_SPLIT | ELE_SPLIT);
    BMO_flag_enable(bm.e, e_new, SUBD_SPLIT | ELE_SPLIT);
  }
  alter_co(bm, v1, p);
  alter_co(bm, v2, p);
}

// Patterns, rotated to match the face; `verts` starts at the first new vert of a cut edge.
function quad_1edge_split(bm, verts, { numcuts }) {
  let add = 2;
  for (let i = 0; i < numcuts; i++) {
    if (numcuts % 2 === 0) {
      if (i === numcuts / 2) add -= 1;
      connect_smallest_face(bm, verts[i], verts[numcuts + add]);
    } else {
      connect_smallest_face(bm, verts[i], verts[numcuts + add]);
      if (i === Math.floor(numcuts / 2)) {
        add -= 1;
        connect_smallest_face(bm, verts[i], verts[numcuts + add]);
      }
    }
  }
}

function quad_2edge_split_path(bm, verts, { numcuts }) {
  for (let i = 0; i < numcuts; i++) connect_smallest_face(bm, verts[i], verts[numcuts + (numcuts - i)]);
  connect_smallest_face(bm, verts[numcuts * 2 + 3], verts[numcuts * 2 + 1]);
}

function quad_2edge_split_innervert(bm, verts, p) {
  const { numcuts } = p;
  let v_last = verts[numcuts];
  for (let i = numcuts - 1; i >= 0; i--) {
    const [e] = connect_smallest_face(bm, verts[i], verts[numcuts + (numcuts - i)]);
    const [v] = bm_subdivide_edge_addvert(bm, e, p, 0.5, 0.5, bm.e.v1[e], bm.e.v2[e]);
    if (i !== numcuts - 1) connect_smallest_face(bm, v_last, v);
    v_last = v;
  }
  connect_smallest_face(bm, v_last, verts[numcuts * 2 + 2]);
}

function quad_2edge_split_fan(bm, verts, { numcuts }) {
  for (let i = 0; i < numcuts; i++) {
    connect_smallest_face(bm, verts[i], verts[numcuts * 2 + 2]);
    connect_smallest_face(bm, verts[numcuts + (numcuts - i)], verts[numcuts * 2 + 2]);
  }
}

function quad_3edge_split(bm, verts, { numcuts }) {
  let add = 0;
  const half = Math.floor(numcuts / 2);
  for (let i = 0; i < numcuts; i++) {
    if (i === half) {
      if (numcuts % 2 !== 0) connect_smallest_face(bm, verts[numcuts - i - 1 + add], verts[i + numcuts + 1]);
      add = numcuts * 2 + 2;
    }
    connect_smallest_face(bm, verts[numcuts - i - 1 + add], verts[i + numcuts + 1]);
  }
  for (let i = 0; i < half + 1; i++) connect_smallest_face(bm, verts[i], verts[numcuts - i + numcuts * 2 + 1]);
}

function quad_4edge_subdivide(bm, verts, p) {
  const { numcuts } = p, s = numcuts + 2;
  const lines = new Array(s * s).fill(-1);
  for (let i = 0; i < s; i++) lines[i] = verts[numcuts * 3 + 2 + (numcuts - i + 1)];
  for (let i = 0; i < s; i++) lines[(s - 1) * s + i] = verts[numcuts + i];
  for (let i = 0; i < numcuts; i++) {
    const a = i, b = numcuts + 1 + numcuts + 1 + (numcuts - i - 1);
    const [e, f_new] = connect_smallest_face(bm, verts[a], verts[b]);
    if (e < 0) continue;
    BMO_flag_enable(bm.e, e, ELE_INNER);
    BMO_flag_enable(bm.f, f_new, ELE_INNER);
    const v1 = lines[(i + 1) * s] = verts[a], v2 = lines[(i + 1) * s + s - 1] = verts[b];
    for (let k = 0; k < numcuts; k++) {
      const [v, e_new] = subdivide_edge_num(bm, e, k, numcuts, p, v1, v2);
      BMO_flag_enable(bm.e, e_new, ELE_INNER);
      lines[(i + 1) * s + k + 1] = v;
    }
  }
  for (let i = 1; i < s; i++) {
    for (let j = 1; j <= numcuts; j++) {
      const [e, f_new] = connect_smallest_face(bm, lines[i * s + j], lines[(i - 1) * s + j]);
      if (e < 0) continue;
      BMO_flag_enable(bm.e, e, ELE_INNER);
      BMO_flag_enable(bm.f, f_new, ELE_INNER);
    }
  }
}

function tri_1edge_split(bm, verts, { numcuts }) {
  for (let i = 0; i < numcuts; i++) connect_smallest_face(bm, verts[i], verts[numcuts + 1]);
}

function tri_3edge_subdivide(bm, verts, p) {
  const { numcuts } = p;
  const lines = [[verts[numcuts * 2 + 1]]];
  lines[numcuts + 1] = [verts[numcuts * 3 + 2], ...verts.slice(0, numcuts), verts[numcuts]];
  for (let i = 0; i < numcuts; i++) {
    const a = numcuts * 2 + 2 + i, b = numcuts + numcuts - i;
    const [e, f_new] = connect_smallest_face(bm, verts[a], verts[b]);
    if (e < 0) return;
    BMO_flag_enable(bm.e, e, ELE_INNER);
    BMO_flag_enable(bm.f, f_new, ELE_INNER);
    lines[i + 1] = new Array(i + 2).fill(-1);
    lines[i + 1][0] = verts[a];
    lines[i + 1][i + 1] = verts[b];
    for (let j = 0; j < i; j++) {
      const [v, e_new] = subdivide_edge_num(bm, e, j, i, p, verts[a], verts[b]);
      lines[i + 1][j + 1] = v;
      BMO_flag_enable(bm.e, e_new, ELE_INNER);
    }
  }
  for (let i = 1; i <= numcuts; i++) {
    for (let j = 0; j < i; j++) {
      for (const [x, y] of [[lines[i][j], lines[i + 1][j + 1]], [lines[i][j + 1], lines[i + 1][j + 1]]]) {
        const [e, f_new] = connect_smallest_face(bm, x, y);
        BMO_flag_enable(bm.e, e, ELE_INNER);
        BMO_flag_enable(bm.f, f_new, ELE_INNER);
      }
    }
  }
}

const quad_1edge = { seledges: [1, 0, 0, 0], connectexec: quad_1edge_split };
const quad_2edge_path = { seledges: [1, 1, 0, 0], connectexec: quad_2edge_split_path };
const quad_2edge_innervert = { seledges: [1, 1, 0, 0], connectexec: quad_2edge_split_innervert };
const quad_2edge_fan = { seledges: [1, 1, 0, 0], connectexec: quad_2edge_split_fan };
const quad_3edge = { seledges: [1, 1, 1, 0], connectexec: quad_3edge_split };
const quad_4edge = { seledges: [1, 1, 1, 1], connectexec: quad_4edge_subdivide };
const tri_1edge = { seledges: [1, 0, 0], connectexec: tri_1edge_split };
const tri_3edge = { seledges: [1, 1, 1], connectexec: tri_3edge_subdivide };
const CORNER_PATTERNS = { [SUBD_CORNER_PATH]: quad_2edge_path, [SUBD_CORNER_INNERVERT]: quad_2edge_innervert, [SUBD_CORNER_FAN]: quad_2edge_fan };

// subdivide_edges. Returns { inner, split, geom } as { v, e, f }. Run through BMO_op_callf.
export function bmo_subdivide_edges_exec(bm, edges, {
  cuts = 1, smooth = 0, quad_corner_type = SUBD_CORNER_STRAIGHT_CUT, use_single_edge = false, use_grid_fill = false,
  use_only_quads = false, use_sphere = false, edge_percents = new Map(),
} = {}) {
  for (const e of edges) BMO_flag_enable(bm.e, e, SUBD_SPLIT);
  const patterns = [use_single_edge ? quad_1edge : null, CORNER_PATTERNS[quad_corner_type] ?? null, use_single_edge ? tri_1edge : null, use_grid_fill ? quad_4edge : null, quad_3edge, use_grid_fill ? tri_3edge : null];
  const p = { numcuts: cuts, smooth, use_sphere, edge_percents, tmp: new Map() };
  for (const e of edge_percents.keys()) BMO_flag_enable(bm.e, e, EDGE_PERCENT);
  const einput = [];
  BM_ITER_MESH(bm.e, (e) => BMO_flag_test(bm.e, e, SUBD_SPLIT) && einput.push(e));

  const facedata = [];
  BM_ITER_MESH(bm.f, (face) => {
    if (use_only_quads && bm.f.len[face] !== 4) return;
    const loops = faceLoops(bm, face), fedges = loops.map((l) => bm.l.e[l]), fverts = loops.map((l) => bm.l.v[l]);
    const split = fedges.map((e) => BMO_flag_test(bm.e, e, SUBD_SPLIT));
    const selected = fedges.filter((e, i) => split[i]);
    let totesel = selected.length;
    if (totesel === 2 && BM_edge_share_vert_check(bm, selected[0], selected[1])) {
      const dir = (e) => { const co = bm.v.co, a = bm.e.v1[e] * 3, b = bm.e.v2[e] * 3, d = [co[b] - co[a], co[b + 1] - co[a + 1], co[b + 2] - co[a + 2]], n = Math.hypot(...d) || 1; return d.map((x) => x / n); };
      const [d1, d2] = selected.map(dir);
      if (Math.abs(d1[0] * d2[0] + d1[1] * d2[1] + d1[2] * d2[2]) > 1 - FLT_FACE_SPLIT_EPSILON) totesel = 0;
    }
    for (const pat of patterns) {
      if (!pat || pat.seledges.length !== bm.f.len[face]) continue;
      const len = pat.seledges.length;
      for (let a = 0; a < len; a++) {
        if (pat.seledges.every((s, b) => split[(b + a) % len] === !!s)) {
          BMO_flag_enable(bm.f, face, SUBD_SPLIT);
          facedata.push({ pat, start: fverts[a], face, totedgesel: totesel });
          return;
        }
      }
    }
    if (totesel) {
      BMO_flag_enable(bm.f, face, SUBD_SPLIT);
      facedata.push({ pat: null, start: -1, face, totedgesel: totesel });
    }
  });

  for (const edge of einput) bm_subdivide_multicut(bm, edge, p, bm.e.v1[edge], bm.e.v2[edge]);
  const applyTmp = () => { for (const [v, co] of p.tmp) bm.v.co.set(co, v * 3); };
  applyTmp();

  // Faces in reverse: Blender pops them from a stack.
  for (const fd of facedata.reverse()) {
    const { face, pat } = fd;
    if (!pat && fd.totedgesel === 2) {
      const loops = faceLoops(bm, face), vlen = loops.length;
      const inner = (i) => BMO_flag_test(bm.v, bm.l.v[loops[i]], ELE_INNER);
      let a = 0;
      for (; a < vlen; a++) if (!inner(a ? a - 1 : vlen - 1) && inner(a)) break;
      let b;
      if (inner((a + cuts + 1) % vlen)) b = (a + cuts + 1) % vlen;
      else {
        for (let j = 0; j < vlen; j++) {
          b = (j + a + cuts + 1) % vlen;
          if (!inner(b === 0 ? vlen - 1 : b - 1) && inner(b)) break;
        }
      }
      b += cuts - 1;
      const splits = [];
      for (let j = 0; j < cuts; j++) {
        // An edge pair shared by another face is ambiguous: skip it (#32500).
        let ok = true;
        BM_ITER_LOOPS_OF_VERT(bm, bm.l.v[loops[a]], (other) => { if (bm.l.f[other] !== face && BM_vert_in_face(bm, bm.l.v[loops[b]], bm.l.f[other])) ok = false; });
        splits.push(ok ? [loops[a], loops[b]] : null);
        b = (b - 1) % vlen;
        a = (a + 1) % vlen;
      }
      for (const pair of splits) {
        if (!pair) continue;
        const result = BM_face_split(bm, face, pair[0], pair[1]);
        if (result) BMO_flag_enable(bm.e, bm.l.e[result[1]], ELE_INNER);
      }
      continue;
    }
    if (!pat) continue;
    const loops = faceLoops(bm, face), len = loops.length;
    const a = loops.findIndex((l) => bm.l.v[l] === fd.start) + 1;
    const verts = new Array(len);
    loops.forEach((l, j) => { verts[(j - a + len) % len] = bm.l.v[l]; });
    pat.connectexec(bm, verts, p);
  }
  applyTmp();

  const collect = (flag) => Object.fromEntries(['v', 'e', 'f'].map((pool) => { const list = []; BM_ITER_MESH(bm[pool], (i) => BMO_flag_test(bm[pool], i, flag) && list.push(i)); return [pool, list]; }));
  return { inner: collect(ELE_INNER), split: collect(ELE_SPLIT), geom: collect(ELE_INNER | ELE_SPLIT | SUBD_SPLIT) };
}

// BM_mesh_esubdivide on the selected edges, with the selection set by `seltype`.
export function BM_mesh_esubdivide(bm, { seltype = SUBDIV_SELECT_ORIG, ...options }) {
  const edges = [];
  BM_ITER_MESH(bm.e, (e) => (bm.e.hflag[e] & BM_ELEM_SELECT) && edges.push(e));
  const { inner } = BMO_op_callf(bm, bmo_subdivide_edges_exec, edges, options);
  const select = (types) => [[BM_VERT, inner.v], [BM_EDGE, inner.e], [BM_FACE, inner.f]].forEach(([htype, list]) => types & htype && list.forEach((ele) => BM_elem_select_set(bm, htype, ele, true)));
  if (seltype === SUBDIV_SELECT_ORIG) { select(BM_VERT | BM_EDGE | BM_FACE); BM_mesh_select_flush_from_verts(bm); }
  else if (seltype === SUBDIV_SELECT_INNER) select(BM_VERT | BM_EDGE);
  else if (seltype === SUBDIV_SELECT_LOOPCUT) { BM_mesh_elem_hflag_disable_all(bm, BM_VERT | BM_EDGE | BM_FACE, BM_ELEM_SELECT); select(BM_EDGE); }
}
