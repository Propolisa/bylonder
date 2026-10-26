// Mid-level topology changes (bmesh_mods.cc).
import { bmesh_kernel_join_vert_kill_edge } from './bmesh-core.js';

export const BM_edge_collapse = (bm, e_kill, v_kill, do_del, kill_degenerate_faces) =>
  bmesh_kernel_join_vert_kill_edge(bm, e_kill, v_kill, do_del, true, kill_degenerate_faces);
