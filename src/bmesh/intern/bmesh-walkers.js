// Walkers (bmesh_walkers.cc, bmesh_walkers_impl.cc) as functions returning the elements in walk order.
import { BMO_flag_test, BM_ELEM_HIDDEN } from './bmesh-class.js';
import { BM_EDGES_OF_VERT, BM_FACES_OF_EDGE, BM_ITER_LOOPS_OF_VERT, BM_edge_other_vert } from './bmesh-query.js';

// The walker masks (bmw_mask_check_*): a tool flag an element needs, and with `test_hidden` not hidden.
const masks = (bm, { mask_vert = 0, mask_edge = 0, mask_face = 0, test_hidden = false }) => {
  const check = (pool, mask) => (i) => !(test_hidden && pool.hflag[i] & BM_ELEM_HIDDEN) && (!mask || BMO_flag_test(pool, i, mask));
  return { vert: check(bm.v, mask_vert), edge: check(bm.e, mask_edge), face: check(bm.f, mask_face) };
};

// BMW_ISLAND and BMW_ISLAND_MANIFOLD: faces connected to `start` through edges, breadth first.
export function BMW_island(bm, start, { only_manifold = false, ...options } = {}) {
  const { l } = bm, check = masks(bm, options);
  if (!check.face(start)) return [];
  const visited = new Set([start]), queue = [start], order = [];
  while (queue.length) {
    const cur = queue.shift();
    order.push(cur);
    const first = bm.f.l_first[cur];
    let it = first;
    do {
      if (!check.edge(l.e[it])) continue;
      if (only_manifold && l.radial_next[it] !== it) {
        let count = 1, r = l.radial_next[it];
        do if (check.face(l.f[r]) && ++count === 3) break; while ((r = l.radial_next[r]) !== it);
        if (count !== 2) continue;
      }
      let r = it;
      while ((r = l.radial_next[r]) !== it) {
        const f = l.f[r];
        if (!check.face(f) || f === cur || visited.has(f)) continue;
        visited.add(f);
        queue.push(f);
        break;
      }
    } while ((it = l.next[it]) !== first);
  }
  return order;
}

// BMW_VERT_SHELL: the edges connected to a vert (or edge) through verts, breadth first. Pass the same `visited` set
// to later walks to skip what earlier ones reached, as one Blender walker over several starts does.
export function BMW_vert_shell(bm, start, { htype = 'v', visited = new Set(), ...options } = {}) {
  const check = masks(bm, options), queue = [];
  const visitEdge = (e) => { if (!visited.has(e) && check.edge(e)) { visited.add(e); queue.push(e); } };
  if (htype === 'v') BM_EDGES_OF_VERT(bm, start).forEach(visitEdge);
  else visitEdge(start);
  for (let i = 0; i < queue.length; i++) {
    const e = queue[i];
    for (const v of [bm.e.v1[e], bm.e.v2[e]]) BM_EDGES_OF_VERT(bm, v).forEach(visitEdge);
  }
  return queue;
}

// BMW_LOOP_SHELL_WIRE: the loops of the faces connected through edges, and the wire edges reached on the way, as
// { loops, edges }, breadth first. Starts at a vert or an edge.
export function BMW_loop_shell_wire(bm, start, { htype = 'v', ...options } = {}) {
  const { l } = bm, check = masks(bm, options), test_hidden = !!options.test_hidden;
  const loops = new Set(), alt = { v: new Set(), e: new Set() }, stack = [], out = { loops: [], edges: [] };
  const is_wire = (e) => bm.e.l[e] < 0 || (test_hidden && BM_FACES_OF_EDGE(bm, e).every((f) => bm.f.hflag[f] & BM_ELEM_HIDDEN));
  const visitLoop = (lp) => { if (!loops.has(lp) && check.face(l.f[lp])) { loops.add(lp); stack.push(['l', lp]); } };
  const visitEdgeWire = (e) => { if (!alt.e.has(e) && check.edge(e)) { alt.e.add(e); stack.push(['e', e]); } };
  const visitVert = (v, e_from = -1) => {
    if (alt.v.has(v) || !check.vert(v)) return;
    for (const e of BM_EDGES_OF_VERT(bm, v)) {
      if (!is_wire(e) || e === e_from) continue;
      visitEdgeWire(e);
      BM_ITER_LOOPS_OF_VERT(bm, BM_edge_other_vert(bm, e, v), visitLoop);
    }
    alt.v.add(v);
  };
  const stepLoop = (lp) => {
    visitLoop(l.next[lp]);
    visitLoop(l.prev[lp]);
    for (const e of [l.e[lp], l.e[l.prev[lp]]]) {
      if (!check.edge(e)) continue;
      const first = bm.e.l[e];
      let it = first;
      do { const radial = l.v[it] === l.v[lp] ? it : l.next[it]; if (radial !== lp) visitLoop(radial); } while ((it = l.radial_next[it]) !== first);
    }
  };
  if (htype === 'v') {
    BM_ITER_LOOPS_OF_VERT(bm, start, visitLoop);
    if (bm.v.e[start] >= 0) visitVert(start);
  } else {
    const first = bm.e.l[start], radial = (fn) => { let it = first; if (first >= 0) do fn(it); while ((it = l.radial_next[it]) !== first); };
    radial(visitLoop);
    if (check.edge(start)) {
      visitVert(bm.e.v1[start]);
      visitVert(bm.e.v2[start]);
    } else radial((it) => { visitLoop(it); visitLoop(l.next[it]); });
  }
  for (let i = 0; i < stack.length; i++) {
    const [kind, ele] = stack[i];
    if (kind === 'l') {
      stepLoop(ele);
      visitVert(l.v[ele]);
      out.loops.push(ele);
    } else {
      visitVert(bm.e.v1[ele], ele);
      visitVert(bm.e.v2[ele], ele);
      out.edges.push(ele);
    }
  }
  return out;
}

// BMW_EDGERING: edges across quads (or even n-gons) from `e_start`, in Blender's order: the walk first rewinds to
// one end of the ring, then walks back across it. `delimit_ngons` keeps it to quads.
export function BMW_edgering(bm, e_start, { delimit_ngons = true, test_hidden = true } = {}) {
  const { l } = bm;
  const hidden = (pool, i) => test_hidden && (pool.hflag[i] & BM_ELEM_HIDDEN) !== 0;
  const manifold = (e) => { const r = bm.e.l[e]; return r >= 0 && l.radial_next[r] !== r && l.radial_next[l.radial_next[r]] === r; };
  const boundary = (e) => { const r = bm.e.l[e]; return r >= 0 && l.radial_next[r] === r; };
  const edgeCheck = (e) => !hidden(bm.e, e) && (boundary(e) || manifold(e));
  const ringFace = (f) => (delimit_ngons ? bm.f.len[f] === 4 : bm.f.len[f] % 2 === 0);
  const visited = new Set(), states = [];
  const step = () => {
    const owalk = states.shift();
    let lp = owalk.l;
    if (lp < 0) return owalk.wireedge;
    const e = l.e[lp];
    if (!edgeCheck(e) || owalk.no_calc) return e;
    const across = (from) => {
      if (delimit_ngons) return l.next[l.next[from]];
      let it = from;
      for (let i = bm.f.len[l.f[from]]; i > 0; i -= 2) it = l.next[it];
      return it;
    };
    lp = across(l.radial_next[lp]);
    if (!ringFace(l.f[lp]) || !edgeCheck(l.e[lp]) || hidden(bm.f, l.f[lp])) lp = across(owalk.l);
    if (ringFace(l.f[lp]) && edgeCheck(l.e[lp]) && !visited.has(l.e[lp])) {
      states.unshift({ l: lp, wireedge: -1, no_calc: false });
      visited.add(l.e[lp]);
    }
    return e;
  };
  const walk = () => { while (states.length) { const e = step(); if (e >= 0) return e; } return -1; };

  states.unshift({ l: bm.e.l[e_start], wireedge: -1, no_calc: false });
  if (bm.e.l[e_start] < 0) states[0].wireedge = e_start;
  else {
    visited.add(e_start);
    let owalk;
    while (states.length) { owalk = { ...states[0] }; walk(); }
    if (!ringFace(l.f[owalk.l])) owalk.l = l.radial_next[owalk.l];
    states.unshift(owalk);
    visited.clear();
    visited.add(l.e[owalk.l]);
    if (l.radial_next[owalk.l] !== owalk.l && (owalk.no_calc || !ringFace(l.f[owalk.l]))) {
      states.unshift({ l: l.radial_next[owalk.l], wireedge: -1, no_calc: false });
    }
  }
  const out = [];
  for (let e = states.length ? step() : -1; e >= 0; e = walk()) out.push(e);
  return out;
}

const manifold = (bm, e) => { const r = bm.e.l[e]; return r >= 0 && bm.l.radial_next[r] !== r && bm.l.radial_next[bm.l.radial_next[r]] === r; };
const boundary = (bm, e) => { const r = bm.e.l[e]; return r >= 0 && bm.l.radial_next[r] === r; };
const otherVert = (bm, e, v) => (bm.e.v1[e] === v ? bm.e.v2[e] : bm.e.v1[e]);
const diskNext = (bm, e, v) => bm.e[bm.e.v1[e] === v ? 'v1_disk_next' : 'v2_disk_next'][e];
const diskEdges = (bm, v) => { const out = [], first = bm.v.e[v]; if (first < 0) return out; let e = first; do out.push(e); while ((e = diskNext(bm, e, v)) !== first); return out; };
const edgeCountNonwire = (bm, v) => diskEdges(bm, v).filter((e) => bm.e.l[e] >= 0).length;
const faceCount = (bm, v) => { let n = 0; for (const e of diskEdges(bm, v)) { const r = bm.e.l[e]; if (r < 0) continue; let l = r; do if (bm.l.v[l] === v) n++; while ((l = bm.l.radial_next[l]) !== r); } return n; };
const loopOtherEdgeLoop = (bm, l, v) => (bm.l.v[l] === v ? bm.l.prev[l] : bm.l.next[l]);
function faceOtherVertLoop(bm, f, v_prev, v) {
  const first = bm.f.l_first[f];
  let l = first;
  do if (bm.l.v[l] === v) { if (bm.l.v[bm.l.prev[l]] === v_prev) return bm.l.next[l]; if (bm.l.v[bm.l.next[l]] === v_prev) return bm.l.prev[l]; return -1; } while ((l = bm.l.next[l]) !== first);
  return -1;
}
const edgeExists = (bm, a, b) => diskEdges(bm, a).find((e) => otherVert(bm, e, a) === b) ?? -1;
const edgeIsSingle = (bm, e) => boundary(bm, e) && bm.f.len[bm.l.f[bm.e.l[e]]] > 4 && (boundary(bm, bm.l.e[bm.l.next[bm.e.l[e]]]) || boundary(bm, bm.l.e[bm.l.prev[bm.e.l[e]]]));

// BMW_EDGELOOP: the edge loop through `e_start` in Blender's walk order, including loops around an n-gon hub and
// boundary loops. `outer_corners` and `ngons` are the boundary delimits (BMW_DELIMIT_EDGE_LOOP_*); seam and sharp
// delimits are not ported yet.
export function BMW_edgeloop(bm, e_start, { test_hidden = true, outer_corners = false, ngons = false } = {}) {
  const { l: L } = bm;
  const maskEdge = (e) => !(test_hidden && (bm.e.hflag[e] & BM_ELEM_HIDDEN));
  const visited = new Set([e_start]), states = [];
  const push = (owalk, cur, lastv) => { states.unshift({ ...owalk, cur, lastv }); visited.add(cur); };
  const step = () => {
    const owalk = states.shift(), e = owalk.cur;
    let lp = bm.e.l[e];
    if (owalk.f_hub >= 0) {
      const v = otherVert(bm, e, owalk.lastv);
      if (edgeCountNonwire(bm, v) === 3) {
        const lo = faceOtherVertLoop(bm, owalk.f_hub, owalk.lastv, v);
        const nexte = edgeExists(bm, v, L.v[lo]);
        if (maskEdge(nexte) && !visited.has(nexte) && !boundary(bm, nexte)) push(owalk, nexte, v);
      }
    } else if (lp < 0) {
      for (const v of [bm.e.v1[e], bm.e.v2[e]]) for (const nexte of diskEdges(bm, v)) if (bm.e.l[nexte] < 0 && maskEdge(nexte) && !visited.has(nexte)) push(owalk, nexte, v);
    } else if (!owalk.is_boundary) {
      const v = otherVert(bm, e, owalk.lastv), tot = edgeCountNonwire(bm, v);
      if (tot === 4 || tot === 2) {
        for (let i = 0; i < tot / 2; i++) {
          lp = loopOtherEdgeLoop(bm, lp, v);
          if (!manifold(bm, L.e[lp])) { lp = -1; break; }
          lp = L.radial_next[lp];
        }
      } else lp = -1;
      if (lp >= 0 && lp !== bm.e.l[e] && maskEdge(L.e[lp]) && !visited.has(L.e[lp])) push(owalk, L.e[lp], v);
    } else {
      const v = otherVert(bm, e, owalk.lastv);
      const corner = outer_corners && edgeCountNonwire(bm, v) === 2 && !edgeIsSingle(bm, e);
      if (corner) lp = -1;
      else for (;;) {
        lp = loopOtherEdgeLoop(bm, lp, v);
        if (manifold(bm, L.e[lp])) lp = L.radial_next[lp];
        else { if (!boundary(bm, L.e[lp])) lp = -1; break; }
      }
      // Stop at delimiting n-gons so the rewind starts from the right edge.
      if (lp >= 0 && ngons && owalk.is_single !== edgeIsSingle(bm, L.e[lp])) lp = -1;
      if (lp >= 0 && lp !== bm.e.l[e] && maskEdge(L.e[lp]) && !visited.has(L.e[lp])) push(owalk, L.e[lp], v);
    }
    return e;
  };
  const walk = () => (states.length ? step() : -1);

  const e = e_start, is_boundary = boundary(bm, e);
  let f_hub = -1;
  if (!is_boundary && [bm.e.v1[e], bm.e.v2[e]].some((v) => edgeCountNonwire(bm, v) === 3 && faceCount(bm, v) === 3)) {
    let f_best = -1;
    const r = bm.e.l[e];
    if (r >= 0) { let l = r; do if (f_best < 0 || bm.f.len[f_best] < bm.f.len[L.f[l]]) f_best = L.f[l]; while ((l = L.radial_next[l]) !== r); }
    f_hub = f_best >= 0 && bm.f.len[f_best] > 4 ? f_best : -1;
  }
  states.unshift({ cur: e, lastv: bm.e.v1[e], is_boundary, is_single: is_boundary && edgeIsSingle(bm, e), f_hub });
  let owalk;
  while (states.length) { owalk = { ...states[0] }; walk(); }
  states.unshift({ ...owalk, lastv: otherVert(bm, owalk.cur, owalk.lastv) });
  visited.clear();
  visited.add(owalk.cur);
  const out = [];
  for (let x = walk(); x >= 0; x = walk()) out.push(x);
  return out;
}

// BMW_FACELOOP (no delimits): the quad loop across `e_start`, as faces in walk order.
export function BMW_faceloop(bm, e_start, { test_hidden = true } = {}) {
  const { l: L } = bm;
  const visited = new Set(), visited_alt = new Set(), states = [];
  const include = (lp) => bm.f.len[L.f[lp]] === 4 && !(test_hidden && (bm.f.hflag[L.f[lp]] & BM_ELEM_HIDDEN)) && !(visited.has(L.f[lp]) && visited_alt.has(L.e[lp]));
  if (bm.e.l[e_start] < 0) return [];
  if (boundary(bm, e_start) && !include(bm.e.l[e_start])) return [];
  if (!manifold(bm, e_start)) return [];
  const step = () => {
    const owalk = states.shift(), f = L.f[owalk.l];
    if (owalk.no_calc) return f;
    let lp = L.radial_next[owalk.l];
    if (!include(lp)) {
      lp = L.next[L.next[owalk.l]];
      if (!manifold(bm, L.e[lp])) lp = L.prev[L.prev[lp]];
      lp = L.radial_next[lp];
    }
    if (include(lp)) {
      states.unshift(bm.f.len[L.f[lp]] !== 4 ? { l: owalk.l, no_calc: true } : { l: lp, no_calc: false });
      visited_alt.add(L.e[lp]);
      visited.add(L.f[lp]);
    }
    return f;
  };
  states.unshift({ l: bm.e.l[e_start], no_calc: false });
  visited.add(L.f[bm.e.l[e_start]]);
  let owalk;
  while (states.length) { owalk = { ...states[0] }; step(); }
  states.unshift({ ...owalk, no_calc: false });
  visited_alt.clear();
  visited_alt.add(L.e[owalk.l]);
  visited.clear();
  visited.add(L.f[owalk.l]);
  const out = [];
  while (states.length) out.push(step());
  return out;
}

// BMW_EDGEBOUNDARY: the boundary edges connected to `e_start` through boundary verts.
export function BMW_edgeboundary(bm, e_start) {
  const out = [e_start], visited = new Set(out);
  for (let i = 0; i < out.length; i++) {
    for (const v of [bm.e.v1[out[i]], bm.e.v2[out[i]]]) {
      for (const e of diskEdges(bm, v)) if (boundary(bm, e) && !visited.has(e)) { visited.add(e); out.push(e); }
    }
  }
  return out;
}
