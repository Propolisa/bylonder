/* Edit Mode in WebAssembly: the BMesh Blender's edit mode makes of a mesh, what JS reads and writes of it (selection,
 * coordinates), and the mesh arrays Blender's edit mode writes back. The module has no ID system, so mesh arrays go in and out
 * as BM_mesh_bm_from_me and BM_mesh_bm_to_me order them: positions, edges, faces and their corners, the UV map, and the
 * flags Blender keeps as boolean attributes (indexed by MeshFlag), any of which may be absent. */
#include "BLI_listbase.h"
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

static BMElem *element_at(BMesh *bm, int htype, int index)
{
  BM_mesh_elem_table_ensure(bm, char(htype));
  return htype == BM_VERT ? reinterpret_cast<BMElem *>(BM_vert_at_index(bm, index)) :
         htype == BM_EDGE ? reinterpret_cast<BMElem *>(BM_edge_at_index(bm, index)) :
                            reinterpret_cast<BMElem *>(BM_face_at_index(bm, index));
}

/* Selects the index-th element of a type and records it in the selection history, as selecting by click does. */
EXPORT(bm_select) void bm_select(BMesh *bm, int htype, int index)
{
  BMElem *ele = element_at(bm, htype, index);
  BM_elem_select_set(bm, ele, true);
  BM_select_history_store(bm, ele);
}

/* The selection history (bm->selected), oldest first, as element types and indices. */
EXPORT(bm_select_history_set) void bm_select_history_set(BMesh *bm, const int *htypes, const int *indices, int len)
{
  BM_select_history_clear(bm);
  for (int i = 0; i < len; i++) {
    BM_select_history_store(bm, element_at(bm, htypes[i], indices[i]));
  }
}
EXPORT(bm_select_history_len) int bm_select_history_len(BMesh *bm) { return BLI_listbase_count(&bm->selected); }
EXPORT(bm_select_history_get) int bm_select_history_get(BMesh *bm, int i, int *htype)
{
  const BMEditSelection *ese = static_cast<const BMEditSelection *>(BLI_findlink(&bm->selected, i));
  BM_mesh_elem_index_ensure(bm, ese->htype);
  *htype = ese->htype;
  return BM_elem_index_get(ese->ele);
}
/* A copy in the same element order with the same selection history (BM_mesh_copy). */
EXPORT(bm_copy) BMesh *bm_copy(BMesh *bm) { return BM_mesh_copy(bm); }

/* Clears the selection and history and sets the selection mode, before selecting anew. */
EXPORT(bm_select_clear) void bm_select_clear(BMesh *bm, int selectmode)
{
  BM_mesh_elem_hflag_disable_all(bm, BM_VERT | BM_EDGE | BM_FACE, BM_ELEM_SELECT, false);
  BM_select_history_clear(bm);
  bm->selectmode = selectmode;
}

/* Selects or deselects elements of one type, in the given order (BM_*_select_set, which flushes down to an element's
 * verts and edges), as box select and its kind set them; flush with EDBM_selectmode_flush afterwards. */
EXPORT(bm_select_elements)
void bm_select_elements(BMesh *bm, int htype, const int *indices, const bool *selects, int len)
{
  for (int i = 0; i < len; i++) {
    BM_elem_select_set(bm, element_at(bm, htype, indices[i]), selects[i]);
  }
}

/* Moves vertices to object-space coordinates, as a transform writes BMVert.co, and updates normals. */
EXPORT(bm_vert_coords_set) void bm_vert_coords_set(BMesh *bm, const int *indices, const float (*coords)[3], int len)
{
  BM_mesh_elem_table_ensure(bm, BM_VERT);
  for (int i = 0; i < len; i++) {
    copy_v3_v3(BM_vert_at_index(bm, indices[i])->co, coords[i]);
  }
  BM_mesh_normals_update(bm);
}

/* Element and selected element counts: verts, edges, faces, then loops. */
EXPORT(bm_totals) void bm_totals(BMesh *bm, int *totals)
{
  const int values[] = {bm->totvert, bm->totvertsel, bm->totedge, bm->totedgesel, bm->totface, bm->totfacesel, bm->totloop};
  std::copy_n(values, 7, totals);
}
