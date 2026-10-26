// The loop cut preview (editmesh_preselect_edgering.cc): the cut lines a loop cut would make, drawn over the mesh
// in the gizmo color.
import { Color4, MeshBuilder, Vector3 } from '@babylonjs/core';
import { BMW_edgering } from '../../bmesh/intern/bmesh-walkers.js';
import { BM_edge_is_any_face_len_test, BM_edge_share_quad_check } from '../../bmesh/intern/bmesh-query.js';
import { user_interface } from '../interface/userdef-default-theme.js';

const co = (bm, v) => Array.from(bm.v.co.subarray(v * 3, v * 3 + 3));
const lerp = (a, b, t) => a.map((x, i) => x + (b[i] - x) * t);
const faceEdges = (bm, f) => { const out = [], first = bm.f.l_first[f]; let l = first; do out.push(bm.l.e[l]); while ((l = bm.l.next[l]) !== first); return out; };

// Orders the verts of `eed` so a cut line to `eed_last` does not cross the previous one (edgering_find_order).
function edgering_find_order(bm, eed_last, eed, eve_last) {
  const { l } = bm;
  const shared = (lp) => faceEdges(bm, l.f[lp]).includes(eed) && faceEdges(bm, l.f[lp]).includes(eed_last);
  let lp = bm.e.l[eed];
  if (!shared(lp)) { const first = lp; do lp = l.radial_next[lp]; while (lp !== first && !shared(lp)); }
  const v1 = bm.e.v1[eed], v2 = bm.e.v2[eed];
  let other = l.v[lp] === v1 ? l.prev[lp] : l.next[lp];
  const rev = other === l.prev[lp];
  while (l.v[other] !== bm.e.v1[eed_last] && l.v[other] !== bm.e.v2[eed_last]) other = rev ? l.prev[other] : l.next[other];
  return l.v[other] === eve_last ? [v1, v2] : [v2, v1];
}

// EDBM_preselect_edgering_update_from_edge: the cut lines (in local Blender coordinates) a loop cut with
// `previewlines` cuts would make, or the cut points on an edge without quads.
export function EDBM_preselect_edgering_update_from_edge(bm, eed_start, previewlines) {
  const facs = Array.from({ length: previewlines }, (_, i) => (i + 1) / (previewlines + 1));
  if (!BM_edge_is_any_face_len_test(bm, eed_start, 4)) {
    return { edges: [], verts: facs.map((t) => lerp(co(bm, bm.e.v1[eed_start]), co(bm, bm.e.v2[eed_start]), t)) };
  }
  const ring = BMW_edgering(bm, eed_start).reverse();
  const edges = [];
  let v0 = null, v1 = null, eve_last = -1, eed_last = -1;
  const lines = () => facs.forEach((t) => edges.push([lerp(co(bm, v0[0]), co(bm, v0[1]), t), lerp(co(bm, v1[0]), co(bm, v1[1]), t)]));
  for (const eed of ring) {
    if (eed_last >= 0) {
      if (eve_last >= 0) v1 = v0;
      else { v1 = [bm.e.v1[eed_last], bm.e.v2[eed_last]]; eve_last = bm.e.v1[eed_last]; }
      v0 = edgering_find_order(bm, eed_last, eed, eve_last);
      eve_last = v0[0];
      lines();
    }
    eed_last = eed;
  }
  const first = ring[ring.length - 1];
  if (eed_last !== first && BM_edge_share_quad_check(bm, eed_last, first)) {
    v1 = v0;
    v0 = edgering_find_order(bm, eed_last, first, eve_last);
    lines();
  }
  return { edges, verts: [] };
}


// Draws a preview for `owner` (local coordinates); `update(preview)` replaces it, null clears it.
export function createPreselectEdgering(owner) {
  const color = new Color4(...user_interface.gizmo_primary, 1);
  let lines = null;
  const toBabylon = ([x, y, z]) => new Vector3(x, z, y);
  return {
    update(preview) {
      lines?.dispose();
      lines = null;
      if (!preview) return;
      // A cut point on an edge without quads shows as a short tick along it.
      const ticks = preview.verts.map((p, i, all) => { const q = all[i + 1] ?? all[i - 1] ?? p; const d = lerp(p, q, 0.04).map((x, k) => x - p[k]); return [p.map((x, k) => x - d[k]), p.map((x, k) => x + d[k])]; });
      const segments = [...preview.edges, ...ticks].map((seg) => seg.map(toBabylon));
      if (!segments.length) return;
      lines = MeshBuilder.CreateLineSystem('loopcut-preview', { lines: segments, colors: segments.map(() => [color, color]) }, owner.getScene());
      lines.parent = owner;
      lines.isPickable = false;
      lines.renderingGroupId = 1;
    },
    dispose() { lines?.dispose(); },
  };
}
