// Duplicate, split and delete operators (bmo_dupe.cc).
import { BMO_flag_enable } from '../intern/bmesh-class.js';
import { BMO_mesh_delete_oflag_context } from '../intern/bmesh-delete.js';

const DEL_INPUT = 1;

// delete: `geom` is { v, e, f } element lists. Run through BMO_op_callf.
export function bmo_delete_exec(bm, geom, context) {
  for (const pool of ['v', 'e', 'f']) for (const i of geom[pool] ?? []) BMO_flag_enable(bm[pool], i, DEL_INPUT);
  BMO_mesh_delete_oflag_context(bm, DEL_INPUT, context);
}
