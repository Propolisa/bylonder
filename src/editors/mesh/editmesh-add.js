// Add Mesh operators (editmesh_add.cc): MESH_OT_primitive_*_add. Each builds the primitive into a new BMesh, as
// Blender does when adding in Object Mode, and returns the Mesh. Properties are the operators' RNA properties.
import { BM_mesh_create, poolLayerAdd } from '../../bmesh/intern/bmesh-class.js';
import { BMO_op_callf } from '../../bmesh/intern/bmesh-operators.js';
import { BM_mesh_bm_to_me } from '../../bmesh/intern/bmesh-mesh-convert.js';
import { bmo_create_grid_exec, bmo_create_cube_exec, bmo_create_circle_exec, bmo_create_cone_exec } from '../../bmesh/operators/bmo-primitive.js';
import rna from '../../makesrna/rna-operators.json' with { type: 'json' };

const FILL = { NOTHING: 0, NGON: 1, TRIFAN: 2 };

function make_prim(exec, args, calc_uvs) {
  const bm = BM_mesh_create();
  if (calc_uvs) poolLayerAdd(bm.l, 'UVMap', Float32Array, 2);
  BMO_op_callf(bm, exec, { ...args, calc_uvs });
  return BM_mesh_bm_to_me(bm);
}

export const primitiveOperators = {
  'mesh.primitive_plane_add': (p) => make_prim(bmo_create_grid_exec, { x_segments: 0, y_segments: 0, size: p.size / 2 }, p.calc_uvs),
  'mesh.primitive_cube_add': (p) => make_prim(bmo_create_cube_exec, { size: p.size }, p.calc_uvs),
  'mesh.primitive_circle_add': (p) => make_prim(bmo_create_circle_exec, { segments: p.vertices, radius: p.radius, cap_ends: FILL[p.fill_type] !== 0, cap_tris: FILL[p.fill_type] === 2 }, p.calc_uvs),
  'mesh.primitive_cylinder_add': (p) => make_prim(bmo_create_cone_exec, { segments: p.vertices, radius1: p.radius, radius2: p.radius, depth: p.depth, cap_ends: FILL[p.end_fill_type] !== 0, cap_tris: FILL[p.end_fill_type] === 2 }, p.calc_uvs),
  'mesh.primitive_cone_add': (p) => make_prim(bmo_create_cone_exec, { segments: p.vertices, radius1: p.radius1, radius2: p.radius2, depth: p.depth, cap_ends: FILL[p.end_fill_type] !== 0, cap_tris: FILL[p.end_fill_type] === 2 }, p.calc_uvs),
  'mesh.primitive_grid_add': (p) => make_prim(bmo_create_grid_exec, { x_segments: p.x_subdivisions, y_segments: p.y_subdivisions, size: p.size / 2 }, p.calc_uvs),
};

// The operator's properties with their RNA defaults, overridden by `props`.
export const operatorProperties = (idname, props = {}) => ({
  ...Object.fromEntries(Object.entries(rna[idname].properties).map(([key, def]) => [key, def.default])),
  ...props,
});

export const primitive_add = (idname, props) => primitiveOperators[idname](operatorProperties(idname, props));
