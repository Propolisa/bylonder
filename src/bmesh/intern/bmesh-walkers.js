// Walkers (bmesh_walkers.cc, bmesh_walkers_impl.cc) as functions returning the elements in walk order.
import { BMO_flag_test, BM_ELEM_HIDDEN } from './bmesh-class.js';

// BMW_ISLAND and BMW_ISLAND_MANIFOLD: faces connected to `start` through edges, breadth first. `faceMask` is a
// tool flag a face needs to be walked onto.
export function BMW_island(bm, start, faceMask, only_manifold = false) {
  const { l } = bm;
  const walkable = (f) => !faceMask || BMO_flag_test(bm.f, f, faceMask);
  if (!walkable(start)) return [];
  const visited = new Set([start]), queue = [start], order = [];
  while (queue.length) {
    const cur = queue.shift();
    order.push(cur);
    const first = bm.f.l_first[cur];
    let it = first;
    do {
      if (only_manifold && l.radial_next[it] !== it) {
        let count = 1, r = l.radial_next[it];
        do if (walkable(l.f[r]) && ++count === 3) break; while ((r = l.radial_next[r]) !== it);
        if (count !== 2) continue;
      }
      let r = it;
      while ((r = l.radial_next[r]) !== it) {
        const f = l.f[r];
        if (!walkable(f) || f === cur || visited.has(f)) continue;
        visited.add(f);
        queue.push(f);
        break;
      }
    } while ((it = l.next[it]) !== first);
  }
  return order;
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
