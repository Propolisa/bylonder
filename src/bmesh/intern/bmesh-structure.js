// Disk and radial cycles (bmesh_structure.cc). A disk link is the (next, prev) pair an edge keeps for one of its
// verts; `link(bm, e, v)` names the field pair, standing in for bmesh_disk_edge_link_from_vert.
const V1_LINK = ['v1_disk_next', 'v1_disk_prev'], V2_LINK = ['v2_disk_next', 'v2_disk_prev'];
const link = (bm, e, v) => (bm.e.v1[e] === v ? V1_LINK : V2_LINK);

export const bmesh_disk_edge_next = (bm, e, v) => bm.e[link(bm, e, v)[0]][e];
export const bmesh_disk_edge_prev = (bm, e, v) => bm.e[link(bm, e, v)[1]][e];

export function bmesh_disk_edge_append(bm, e, v) {
  const [next, prev] = link(bm, e, v);
  if (bm.v.e[v] < 0) {
    bm.v.e[v] = e;
    bm.e[next][e] = bm.e[prev][e] = e;
    return;
  }
  const first = bm.v.e[v];
  const [, firstPrev] = link(bm, first, v);
  const last = bm.e[firstPrev][first];
  bm.e[next][e] = first;
  bm.e[prev][e] = last;
  bm.e[firstPrev][first] = e;
  if (last >= 0) bm.e[link(bm, last, v)[0]][last] = e;
}

export function bmesh_disk_edge_remove(bm, e, v) {
  const [next, prev] = link(bm, e, v);
  const n = bm.e[next][e], p = bm.e[prev][e];
  if (p >= 0) bm.e[link(bm, p, v)[0]][p] = n;
  if (n >= 0) bm.e[link(bm, n, v)[1]][n] = p;
  if (bm.v.e[v] === e) bm.v.e[v] = e !== n ? n : -1;
  bm.e[next][e] = bm.e[prev][e] = -1;
}

export function bmesh_disk_vert_swap(bm, e, v_dst, v_src) {
  if (bm.e.v1[e] === v_src) {
    bm.e.v1[e] = v_dst;
    bm.e.v1_disk_next[e] = bm.e.v1_disk_prev[e] = -1;
  } else if (bm.e.v2[e] === v_src) {
    bm.e.v2[e] = v_dst;
    bm.e.v2_disk_next[e] = bm.e.v2_disk_prev[e] = -1;
  }
}

export function bmesh_disk_vert_replace(bm, e, v_dst, v_src) {
  bmesh_disk_edge_remove(bm, e, v_src);
  bmesh_disk_vert_swap(bm, e, v_dst, v_src);
  bmesh_disk_edge_append(bm, e, v_dst);
}

export function bmesh_edge_vert_swap(bm, e, v_dst, v_src) {
  const { l } = bm;
  const first = bm.e.l[e];
  if (first >= 0) {
    let it = first;
    do {
      if (l.v[it] === v_src) l.v[it] = v_dst;
      else if (l.v[l.next[it]] === v_src) l.v[l.next[it]] = v_dst;
    } while ((it = l.radial_next[it]) !== first);
  }
  bmesh_disk_vert_replace(bm, e, v_dst, v_src);
}

export function bmesh_radial_loop_append(bm, e, lp) {
  const { l } = bm;
  const first = bm.e.l[e];
  if (first < 0) {
    bm.e.l[e] = lp;
    l.radial_next[lp] = l.radial_prev[lp] = lp;
  } else {
    l.radial_prev[lp] = first;
    l.radial_next[lp] = l.radial_next[first];
    l.radial_prev[l.radial_next[first]] = lp;
    l.radial_next[first] = lp;
    bm.e.l[e] = lp;
  }
  l.e[lp] = e;
}

export function bmesh_radial_loop_remove(bm, e, lp) {
  const { l } = bm;
  if (l.radial_next[lp] !== lp) {
    if (lp === bm.e.l[e]) bm.e.l[e] = l.radial_next[lp];
    l.radial_prev[l.radial_next[lp]] = l.radial_prev[lp];
    l.radial_next[l.radial_prev[lp]] = l.radial_next[lp];
  } else if (lp === bm.e.l[e]) {
    bm.e.l[e] = -1;
  }
  l.radial_next[lp] = l.radial_prev[lp] = -1;
  l.e[lp] = -1;
}

export function bmesh_radial_length(bm, lp) {
  if (lp < 0) return 0;
  let i = 0, it = lp;
  do i++; while ((it = bm.l.radial_next[it]) !== lp);
  return i;
}
