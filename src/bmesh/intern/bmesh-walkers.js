// Walkers (bmesh_walkers.cc, bmesh_walkers_impl.cc) as functions returning the elements in walk order.
import { BMO_flag_test } from './bmesh-class.js';

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
