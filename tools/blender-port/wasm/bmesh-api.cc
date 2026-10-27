/* Edit Mode in WebAssembly: the BMesh Blender's edit mode makes of a mesh, operators as Blender's edbm_*_exec run
 * them, and the mesh arrays Blender's edit mode writes back. The module has no ID system, so mesh arrays go in and out
 * as BM_mesh_bm_from_me and BM_mesh_bm_to_me order them: positions, edges, faces and their corners, the UV map, and the
 * flags Blender keeps as boolean attributes (indexed by MeshFlag), any of which may be absent. */
#include "BLI_array.hh"
#include "BLI_math_rotation.h"
#include "BLI_math_vector.h"
#include "BKE_customdata.hh"
#include "DNA_scene_types.h"
#include "bmesh.hh"

using namespace blender;

#define EXPORT(name) extern "C" __attribute__((export_name(#name)))

/* The boolean attributes BM_mesh_bm_from_me reads and BM_mesh_bm_to_me writes. */
enum MeshFlag { SELECT_VERT, HIDE_VERT, SELECT_EDGE, HIDE_EDGE, UV_SEAM, SHARP_EDGE, SELECT_POLY, HIDE_POLY, SHARP_FACE, FLAGS_NUM };

/* BM_mesh_bm_from_me for a new BMesh with tool flags (EDBM_mesh_make), then normals as edit mode has them. */
EXPORT(bm_from_arrays)
BMesh *bm_from_arrays(int verts_num, const float (*positions)[3], int edges_num, const int (*edges)[2], int faces_num,
                      const int *face_offsets, const int *corner_verts, const int *corner_edges, const float (*uvs)[2],
                      const bool *const *flags, int selectmode)
{
  auto flag = [&](MeshFlag f, int i) { return flags[f] && flags[f][i]; };
  BMeshCreateParams create_params{};
  create_params.use_toolflags = true;
  const BMAllocTemplate allocsize = {verts_num, edges_num, face_offsets[faces_num], faces_num};
  BMesh *bm = BM_mesh_create(&allocsize, &create_params);
  bm->selectmode = selectmode;
  if (uvs) {
    BM_data_layer_add_named(bm, &bm->ldata, CD_PROP_FLOAT2, "UVMap");
  }
  const int cd_uv = CustomData_get_offset_named(&bm->ldata, CD_PROP_FLOAT2, "UVMap");
  Array<BMVert *> vtable(verts_num);
  for (int i = 0; i < verts_num; i++) {
    BMVert *v = vtable[i] = BM_vert_create(bm, positions[i], nullptr, BM_CREATE_SKIP_CD);
    BM_elem_index_set(v, i); /* set_ok */
    if (flag(HIDE_VERT, i)) {
      BM_elem_flag_enable(v, BM_ELEM_HIDDEN);
    }
    if (flag(SELECT_VERT, i)) {
      BM_vert_select_set(bm, v, true);
    }
  }
  Array<BMEdge *> etable(edges_num);
  for (int i = 0; i < edges_num; i++) {
    BMEdge *e = etable[i] = BM_edge_create(bm, vtable[edges[i][0]], vtable[edges[i][1]], nullptr, BM_CREATE_SKIP_CD);
    BM_elem_index_set(e, i); /* set_ok */
    e->head.hflag = 0;
    if (flag(UV_SEAM, i)) {
      BM_elem_flag_enable(e, BM_ELEM_SEAM);
    }
    if (flag(HIDE_EDGE, i)) {
      BM_elem_flag_enable(e, BM_ELEM_HIDDEN);
    }
    if (flag(SELECT_EDGE, i)) {
      BM_edge_select_set(bm, e, true);
    }
    if (!flag(SHARP_EDGE, i)) {
      BM_elem_flag_enable(e, BM_ELEM_SMOOTH);
    }
  }
  int totloops = 0;
  for (int i = 0; i < faces_num; i++) {
    const int start = face_offsets[i], size = face_offsets[i + 1] - start;
    Array<BMVert *, BM_DEFAULT_NGON_STACK_SIZE> verts(size);
    Array<BMEdge *, BM_DEFAULT_NGON_STACK_SIZE> fedges(size);
    for (int j = 0; j < size; j++) {
      verts[j] = vtable[corner_verts[start + j]];
      fedges[j] = etable[corner_edges[start + j]];
    }
    BMFace *f = BM_face_create(bm, verts.data(), fedges.data(), size, nullptr, BM_CREATE_SKIP_CD);
    BM_elem_index_set(f, bm->totface - 1); /* set_ok */
    if (!flag(SHARP_FACE, i)) {
      BM_elem_flag_enable(f, BM_ELEM_SMOOTH);
    }
    if (flag(HIDE_POLY, i)) {
      BM_elem_flag_enable(f, BM_ELEM_HIDDEN);
    }
    if (flag(SELECT_POLY, i)) {
      BM_face_select_set(bm, f, true);
    }
    BMLoop *l_iter, *l_first;
    l_iter = l_first = BM_FACE_FIRST_LOOP(f);
    do {
      if (cd_uv != -1) {
        CustomData_bmesh_set_default(&bm->ldata, &l_iter->head.data);
        copy_v2_v2(BM_ELEM_CD_GET_FLOAT_P(l_iter, cd_uv), uvs[totloops]);
      }
      BM_elem_index_set(l_iter, totloops++); /* set_ok */
    } while ((l_iter = l_iter->next) != l_first);
  }
  bm->elem_index_dirty &= ~(BM_VERT | BM_EDGE | BM_FACE | BM_LOOP);
  BM_mesh_normals_update(bm);
  return bm;
}
EXPORT(bm_free) void bm_free(BMesh *bm) { BM_mesh_free(bm); }

/* Element counts, after indexing the elements in the order BM_mesh_bm_to_me writes them. */
EXPORT(bm_size) int bm_size(BMesh *bm, int what)
{
  BM_mesh_elem_index_ensure(bm, BM_VERT | BM_EDGE | BM_FACE | BM_LOOP);
  const int sizes[] = {bm->totvert, bm->totedge, bm->totface, bm->totloop};
  return sizes[what];
}

/* Whether the BMesh has the UV map. */
EXPORT(bm_has_uv) bool bm_has_uv(BMesh *bm)
{
  return CustomData_get_offset_named(&bm->ldata, CD_PROP_FLOAT2, "UVMap") != -1;
}

/* BM_mesh_bm_to_me's arrays, into buffers sized by bm_size; uvs only when bm_has_uv. */
EXPORT(bm_to_arrays)
void bm_to_arrays(BMesh *bm, float (*positions)[3], int (*edges)[2], int *face_offsets, int *corner_verts,
                  int *corner_edges, float (*uvs)[2], bool *const *flags)
{
  auto set = [&](MeshFlag f, int i, const BMHeader &head, char hflag) { flags[f][i] = (head.hflag & hflag) != 0; };
  const int cd_uv = CustomData_get_offset_named(&bm->ldata, CD_PROP_FLOAT2, "UVMap");
  BM_mesh_elem_index_ensure(bm, BM_VERT | BM_EDGE | BM_FACE | BM_LOOP);
  BMIter iter;
  BMVert *v;
  int i;
  BM_ITER_MESH_INDEX (v, &iter, bm, BM_VERTS_OF_MESH, i) {
    copy_v3_v3(positions[i], v->co);
    set(SELECT_VERT, i, v->head, BM_ELEM_SELECT);
    set(HIDE_VERT, i, v->head, BM_ELEM_HIDDEN);
  }
  BMEdge *e;
  BM_ITER_MESH_INDEX (e, &iter, bm, BM_EDGES_OF_MESH, i) {
    edges[i][0] = BM_elem_index_get(e->v1);
    edges[i][1] = BM_elem_index_get(e->v2);
    set(SELECT_EDGE, i, e->head, BM_ELEM_SELECT);
    set(HIDE_EDGE, i, e->head, BM_ELEM_HIDDEN);
    set(UV_SEAM, i, e->head, BM_ELEM_SEAM);
    flags[SHARP_EDGE][i] = !BM_elem_flag_test(e, BM_ELEM_SMOOTH);
  }
  BMFace *f;
  int corner = 0;
  BM_ITER_MESH_INDEX (f, &iter, bm, BM_FACES_OF_MESH, i) {
    face_offsets[i] = corner;
    set(SELECT_POLY, i, f->head, BM_ELEM_SELECT);
    set(HIDE_POLY, i, f->head, BM_ELEM_HIDDEN);
    flags[SHARP_FACE][i] = !BM_elem_flag_test(f, BM_ELEM_SMOOTH);
    BMLoop *l_iter, *l_first;
    l_iter = l_first = BM_FACE_FIRST_LOOP(f);
    do {
      corner_verts[corner] = BM_elem_index_get(l_iter->v);
      corner_edges[corner] = BM_elem_index_get(l_iter->e);
      if (cd_uv != -1) {
        copy_v2_v2(uvs[corner], BM_ELEM_CD_GET_FLOAT_P(l_iter, cd_uv));
      }
      corner++;
    } while ((l_iter = l_iter->next) != l_first);
  }
  face_offsets[bm->totface] = corner;
}

/* Selects the index-th element of a type and records it in the selection history, as selecting by click does. */
EXPORT(bm_select) void bm_select(BMesh *bm, int htype, int index)
{
  BM_mesh_elem_table_ensure(bm, char(htype));
  BMElem *ele = htype == BM_VERT ? reinterpret_cast<BMElem *>(BM_vert_at_index(bm, index)) :
                htype == BM_EDGE ? reinterpret_cast<BMElem *>(BM_edge_at_index(bm, index)) :
                                   reinterpret_cast<BMElem *>(BM_face_at_index(bm, index));
  BM_elem_select_set(bm, ele, true);
  BM_select_history_store(bm, ele);
}
EXPORT(bm_select_flush) void bm_select_flush(BMesh *bm) { BM_mesh_select_mode_flush(bm); }

/* edbm_quads_convert_to_tris_exec (editmesh_tools.cc). */
EXPORT(mesh_quads_convert_to_tris) bool mesh_quads_convert_to_tris(BMesh *bm, int quad_method, int ngon_method)
{
  if (bm->totfacesel == 0) {
    return false;
  }
  BMOperator bmop;
  BMOIter oiter;
  BMFace *f;
  BM_custom_loop_normals_to_vector_layer(bm);
  BMO_op_initf(bm, &bmop, BMO_FLAG_DEFAULTS, "triangulate faces=%hf quad_method=%i ngon_method=%i", BM_ELEM_SELECT,
               quad_method, ngon_method);
  BMO_op_exec(bm, &bmop);
  BMO_slot_buffer_hflag_enable(bm, bmop.slots_out, "faces.out", BM_FACE, BM_ELEM_SELECT, true);
  BMO_ITER (f, &oiter, bmop.slots_out, "face_map_double.out", BM_FACE) {
    BM_face_kill(bm, f);
  }
  BM_mesh_select_mode_flush_ex(bm, bm->selectmode, BMSelectFlushFlag_All);
  BMO_op_finish(bm, &bmop);
  BM_custom_loop_normals_from_vector_layer(bm, false);
  return true;
}

/* EDBM_op_finish without reports: false when the operator cancelled. */
static bool edbm_op_finish(BMesh *bm, BMOperator *bmop)
{
  BMO_op_finish(bm, bmop);
  const char *errmsg;
  eBMOpErrorLevel level;
  bool cancelled = false;
  while (BMO_error_pop(bm, &errmsg, nullptr, &level)) {
    cancelled |= level == BMO_ERROR_CANCEL;
  }
  return !cancelled;
}

/* EDBM_op_callf. */
static bool edbm_op_callf(BMesh *bm, const char *fmt, ...)
{
  BMOperator bmop;
  va_list list;
  va_start(list, fmt);
  const bool ok = BMO_op_vinitf(bm, &bmop, BMO_FLAG_DEFAULTS, fmt, list);
  va_end(list);
  if (!ok) {
    return false;
  }
  BMO_op_exec(bm, &bmop);
  return edbm_op_finish(bm, &bmop);
}

/* EDBM_op_call_and_selectf. */
static bool edbm_op_call_and_selectf(BMesh *bm, const char *select_slot_out, const bool select_extend, const char *fmt, ...)
{
  BMOperator bmop;
  va_list list;
  va_start(list, fmt);
  const bool ok = BMO_op_vinitf(bm, &bmop, BMO_FLAG_DEFAULTS, fmt, list);
  va_end(list);
  if (!ok) {
    return false;
  }
  BMO_op_exec(bm, &bmop);
  BMOpSlot *slot_select_out = BMO_slot_get(bmop.slots_out, select_slot_out);
  const char hflag = slot_select_out->slot_subtype.elem & BM_ALL_NOLOOP;
  if (!select_extend) {
    BM_mesh_elem_hflag_disable_all(bm, BM_VERT | BM_EDGE | BM_FACE, BM_ELEM_SELECT, false);
  }
  BMO_slot_buffer_hflag_enable(bm, bmop.slots_out, select_slot_out, hflag, BM_ELEM_SELECT, true);
  return edbm_op_finish(bm, &bmop);
}

/* The operators below leave out Blender's custom normal handling: the meshes have no custom normal layer. */

/* edbm_flip_normals_exec, face winding (editmesh_tools.cc). */
EXPORT(mesh_flip_normals) bool mesh_flip_normals(BMesh *bm)
{
  return bm->totfacesel && edbm_op_callf(bm, "reverse_faces faces=%hf flip_multires=%b", BM_ELEM_SELECT, true);
}

/* edbm_normals_make_consistent_exec. */
EXPORT(mesh_normals_make_consistent) bool mesh_normals_make_consistent(BMesh *bm, bool inside)
{
  if (bm->totfacesel == 0 || !edbm_op_callf(bm, "recalc_face_normals faces=%hf", BM_ELEM_SELECT)) {
    return false;
  }
  if (inside) {
    edbm_op_callf(bm, "reverse_faces faces=%hf flip_multires=%b", BM_ELEM_SELECT, true);
  }
  return true;
}

/* edbm_do_smooth_vertex_exec, without mirror modifiers or symmetry. */
EXPORT(mesh_vertices_smooth)
bool mesh_vertices_smooth(BMesh *bm, float fac, int repeat, bool xaxis, bool yaxis, bool zaxis)
{
  if (bm->totvertsel == 0) {
    return false;
  }
  for (int i = 0; i < (repeat ? repeat : 1); i++) {
    edbm_op_callf(bm,
                  "smooth_vert verts=%hv factor=%f mirror_clip_x=%b mirror_clip_y=%b mirror_clip_z=%b "
                  "clip_dist=%f use_axis_x=%b use_axis_y=%b use_axis_z=%b",
                  BM_ELEM_SELECT, fac, false, false, false, 0.0f, xaxis, yaxis, zaxis);
  }
  return true;
}

/* edbm_poke_face_exec. */
EXPORT(mesh_poke) bool mesh_poke(BMesh *bm, float offset, bool use_relative_offset, int center_mode)
{
  if (bm->totfacesel == 0) {
    return false;
  }
  BMOperator bmop;
  BMO_op_initf(bm, &bmop, BMO_FLAG_DEFAULTS, "poke faces=%hf offset=%f use_relative_offset=%b center_mode=%i",
               BM_ELEM_SELECT, offset, use_relative_offset, center_mode);
  BMO_op_exec(bm, &bmop);
  BM_mesh_elem_hflag_disable_all(bm, BM_VERT | BM_EDGE | BM_FACE, BM_ELEM_SELECT, false);
  BMO_slot_buffer_hflag_enable(bm, bmop.slots_out, "verts.out", BM_VERT, BM_ELEM_SELECT, true);
  BMO_slot_buffer_hflag_enable(bm, bmop.slots_out, "faces.out", BM_FACE, BM_ELEM_SELECT, true);
  return edbm_op_finish(bm, &bmop);
}

/* edbm_tris_convert_to_quads_exec. */
EXPORT(mesh_tris_convert_to_quads)
bool mesh_tris_convert_to_quads(BMesh *bm, float face_threshold, bool face_threshold_set, float shape_threshold,
                                bool shape_threshold_set, bool seam, bool sharp, bool uvs, bool vcols, bool materials,
                                float topology_influence, bool deselect_joined)
{
  if (bm->totfacesel == 0) {
    return false;
  }
  /* A selected face pair joins whatever its angles, unless a threshold was given. */
  const bool is_face_pair = bm->totfacesel == 2;
  face_threshold = is_face_pair && !face_threshold_set ? DEG2RADF(180.0f) : face_threshold;
  shape_threshold = is_face_pair && !shape_threshold_set ? DEG2RADF(180.0f) : shape_threshold;
  if (!edbm_op_call_and_selectf(bm, "faces.out", !deselect_joined,
                                "join_triangles faces=%hf angle_face_threshold=%f angle_shape_threshold=%f "
                                "cmp_seam=%b cmp_sharp=%b cmp_uvs=%b cmp_vcols=%b cmp_materials=%b "
                                "topology_influence=%f deselect_joined=%b",
                                BM_ELEM_SELECT, face_threshold, shape_threshold, seam, sharp, uvs, vcols, materials,
                                topology_influence, deselect_joined))
  {
    return false;
  }
  if (deselect_joined && (bm->selectmode & (SCE_SELECT_VERTEX | SCE_SELECT_EDGE))) {
    BM_mesh_select_mode_flush_ex(bm, bm->selectmode, BMSelectFlushFlag_All);
  }
  return true;
}

/* Clears the selection and history and sets the selection mode, before selecting anew. */
EXPORT(bm_select_clear) void bm_select_clear(BMesh *bm, int selectmode)
{
  BM_mesh_elem_hflag_disable_all(bm, BM_VERT | BM_EDGE | BM_FACE, BM_ELEM_SELECT, false);
  BM_select_history_clear(bm);
  bm->selectmode = selectmode;
}
