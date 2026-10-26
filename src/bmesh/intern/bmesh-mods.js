// Mid-level topology changes (bmesh_mods.cc).
import { bmesh_kernel_join_vert_kill_edge } from './bmesh-core.js';

export const BM_edge_collapse = (bm, e_kill, v_kill, do_del, kill_degenerate_faces) =>
  bmesh_kernel_join_vert_kill_edge(bm, e_kill, v_kill, do_del, true, kill_degenerate_faces);

export function BM_edge_verts_swap(bm, e) {
  const { e: E } = bm;
  [E.v1[e], E.v2[e]] = [E.v2[e], E.v1[e]];
  [E.v1_disk_next[e], E.v2_disk_next[e]] = [E.v2_disk_next[e], E.v1_disk_next[e]];
  [E.v1_disk_prev[e], E.v2_disk_prev[e]] = [E.v2_disk_prev[e], E.v1_disk_prev[e]];
}
