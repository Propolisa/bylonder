// Add Mesh operators (editmesh_add.cc): MESH_OT_primitive_*_add. Each builds the primitive into a new BMesh, as
// Blender does when adding in Object Mode, and returns the Mesh. Properties are the operators' RNA properties.
import { BM_mesh_create } from '../../bmesh/intern/bmesh-class.js';
import { BM_data_layer_add_named } from '../../bmesh/intern/bmesh-interp.js';
import { CD_PROP_FLOAT2 } from '../../makesdna/customdata-types.js';
import { bmo_call } from '../../bmesh/intern/bmesh-operators.js';
import { BM_mesh_bm_to_me } from '../../bmesh/intern/bmesh-mesh-convert.js';
import { bmo_create_grid_exec, bmo_create_cube_exec, bmo_create_circle_exec, bmo_create_cone_exec } from '../../bmesh/operators/bmo-primitive.js';
import rna from '../../makesrna/rna-operators.json' with { type: 'json' };
import { EditMesh, meshFromFaces } from '../../bmesh/bmesh-wasm.js';
import { add_torus, add_uvs } from '../../bl_ui/add_mesh_torus.js';
import { createMesh } from '../../blenkernel/mesh/mesh.js';
import { SCE_SELECT_VERTEX, BM_mesh_elem_hflag_enable_all, BM_mesh_select_mode_flush_ex } from '../../bmesh/intern/bmesh-marking.js';
import { BM_VERT, BM_ELEM_SELECT } from '../../bmesh/intern/bmesh-class.js';

const FILL = { NOTHING: 0, NGON: 1, TRIFAN: 2 };

function make_prim(exec, args, calc_uvs) {
  const bm = BM_mesh_create();
  if (calc_uvs) BM_data_layer_add_named(bm, bm.ldata, CD_PROP_FLOAT2, 'UVMap');
  bmo_call(bm, exec, { ...args, calc_uvs });
  // EDBM_op_call_and_selectf selects "verts.out" (the whole new mesh) and make_prim_finish flushes it.
  BM_mesh_elem_hflag_enable_all(bm, BM_VERT, BM_ELEM_SELECT);
  BM_mesh_select_mode_flush_ex(bm, SCE_SELECT_VERTEX);
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

// mesh.primitive_torus_add: Blender's Python (add_mesh_torus.py, transpiled into src/bl_ui) makes the vertices, quads
// and UVs, as AddTorus.execute calls it; edges come as mesh.update() derives them, and the faces are shaded flat.
function torus_add(p) {
  const extra = (p.abso_major_rad - p.abso_minor_rad) * 0.5;
  const [major_radius, minor_radius] = p.mode === 'EXT_INT' ? [p.abso_minor_rad + extra, extra] : [p.major_radius, p.minor_radius];
  const [verts, faces] = add_torus(major_radius, minor_radius, p.major_segments, p.minor_segments);
  const faces_num = faces.length / 4;
  const mesh = meshFromFaces(verts, Array.from({ length: faces_num + 1 }, (_, f) => f * 4), faces);
  mesh.attributes.set('sharp_face', { domain: 'FACE', type: 'BOOLEAN', data: new Uint8Array(faces_num).fill(1) });
  if (p.generate_uvs) {
    const uv = new Float32Array(faces.length * 2);
    const data = Array.from({ length: faces.length }, (_, c) => ({ set uv([u, v]) { uv[c * 2] = u; uv[c * 2 + 1] = v; } }));
    const polygons = Array.from({ length: faces_num }, (_, f) => ({ loop_indices: [f * 4, f * 4 + 1, f * 4 + 2, f * 4 + 3] }));
    // Transcrypt renames Python's `new` to py_new.
    add_uvs({ uv_layers: { py_new() {}, active: { data } }, polygons }, p.minor_segments, p.major_segments);
    mesh.attributes.set('UVMap', { domain: 'CORNER', type: 'FLOAT2', data: uv });
  }
  return mesh;
}
primitiveOperators['mesh.primitive_torus_add'] = torus_add;

// A primitive whose builder has no JS port: Blender's operator adds it to an empty edit mesh, as in Edit Mode.
function operator_add(idname, props) {
  const edit = EditMesh.fromMesh(createMesh({ vert_positions: [], edges: [], face_offsets: [0], corner_verts: [], corner_edges: [] }), SCE_SELECT_VERTEX);
  try {
    const { report } = edit.run(idname, props);
    if (report) throw new Error(report);
    return edit.toMesh();
  } finally {
    edit.free();
  }
}

// Ported builders take every property; Blender's operator takes the ones set, as unset ones (scale) mean their own.
export const primitive_add = (idname, props = {}) =>
  (primitiveOperators[idname] ? primitiveOperators[idname](operatorProperties(idname, props)) : operator_add(idname, props));
