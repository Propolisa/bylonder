/* Edit Mode in WebAssembly: the BMesh Blender's edit mode makes of a mesh, what JS reads and writes of it (its selection),
 * and the mesh arrays Blender's edit mode writes back. The module has no ID system, so mesh arrays go in and out
 * as BM_mesh_bm_from_me and BM_mesh_bm_to_me order them: positions, edges, faces and their corners, the UV map, and the
 * flags Blender keeps as boolean attributes (indexed by MeshFlag), any of which may be absent. */
#include "BLI_listbase.h"
#include "BLI_array.hh"
#include "BLI_math_rotation.h"
#include "BLI_math_geom.h"
#include "BLI_math_vector.h"
#include "BKE_customdata.hh"
#include "DNA_scene_types.h"
#include "bmesh.hh"
#include "extraction.hh"

using namespace blender;

#define EXPORT(name) extern "C" __attribute__((export_name(#name)))


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

template<typename T> static T *sized(Vector<T> &buffer, int size)
{
  buffer.resize(size);
  return buffer.data();
}

/* BM_mesh_bm_to_me's arrays and order, with the normals and triangles Blender's edit mode draws (the BMesh's own,
 * and BM_mesh_calc_tessellation's as BKE_editmesh_looptris_calc has them). */
void blender::extraction_update(BMesh *bm, Extraction &ex, int what)
{
  ExtractionHeader &h = ex.header;
  if (what & EXTRACT_TOPOLOGY) {
    what |= EXTRACT_POSITIONS | EXTRACT_FLAGS | EXTRACT_UV;
  }
  BM_mesh_elem_index_ensure(bm, BM_VERT | BM_EDGE | BM_FACE | BM_LOOP);
  BMIter iter;
  BMVert *v;
  BMEdge *e;
  BMFace *f;
  int i;
  if (what & EXTRACT_TOPOLOGY) {
    h.verts_num = bm->totvert;
    h.edges_num = bm->totedge;
    h.faces_num = bm->totface;
    h.corners_num = bm->totloop;
    h.tris_num = poly_to_tri_count(bm->totface, bm->totloop);
    h.edges = reinterpret_cast<int(*)[2]>(sized(ex.edges, h.edges_num));
    h.face_offsets = sized(ex.face_offsets, h.faces_num + 1);
    h.corner_verts = sized(ex.corner_verts, h.corners_num);
    h.corner_edges = sized(ex.corner_edges, h.corners_num);
    BM_ITER_MESH_INDEX (e, &iter, bm, BM_EDGES_OF_MESH, i) {
      h.edges[i][0] = BM_elem_index_get(e->v1);
      h.edges[i][1] = BM_elem_index_get(e->v2);
    }
    int corner = 0;
    BM_ITER_MESH_INDEX (f, &iter, bm, BM_FACES_OF_MESH, i) {
      h.face_offsets[i] = corner;
      BMLoop *l_iter, *l_first;
      l_iter = l_first = BM_FACE_FIRST_LOOP(f);
      do {
        h.corner_verts[corner] = BM_elem_index_get(l_iter->v);
        h.corner_edges[corner++] = BM_elem_index_get(l_iter->e);
      } while ((l_iter = l_iter->next) != l_first);
    }
    h.face_offsets[h.faces_num] = corner;
  }
  if (what & EXTRACT_POSITIONS) {
    h.positions = reinterpret_cast<float(*)[3]>(sized(ex.positions, h.verts_num));
    h.vert_normals = reinterpret_cast<float(*)[3]>(sized(ex.vert_normals, h.verts_num));
    h.face_normals = reinterpret_cast<float(*)[3]>(sized(ex.face_normals, h.faces_num));
    h.corner_tris = reinterpret_cast<int(*)[3]>(sized(ex.corner_tris, h.tris_num));
    h.tri_faces = sized(ex.tri_faces, h.tris_num);
    BM_ITER_MESH_INDEX (v, &iter, bm, BM_VERTS_OF_MESH, i) {
      copy_v3_v3(h.positions[i], v->co);
      copy_v3_v3(h.vert_normals[i], v->no);
    }
    BM_ITER_MESH_INDEX (f, &iter, bm, BM_FACES_OF_MESH, i) {
      copy_v3_v3(h.face_normals[i], f->no);
    }
    Array<std::array<BMLoop *, 3>> looptris(h.tris_num);
    BM_mesh_calc_tessellation(bm, looptris);
    for (i = 0; i < h.tris_num; i++) {
      for (int j = 0; j < 3; j++) {
        h.corner_tris[i][j] = BM_elem_index_get(looptris[i][j]);
      }
      h.tri_faces[i] = BM_elem_index_get(looptris[i][0]->f);
    }
  }
  if (what & EXTRACT_FLAGS) {
    const int sizes[FLAGS_NUM] = {h.verts_num, h.verts_num, h.edges_num, h.edges_num, h.edges_num, h.edges_num,
                                  h.faces_num, h.faces_num, h.faces_num};
    for (int flag = 0; flag < FLAGS_NUM; flag++) {
      h.flags[flag] = sized(ex.flags[flag], sizes[flag]);
    }
    auto set = [&](MeshFlag flag, int i, const BMHeader &head, char hflag) { h.flags[flag][i] = (head.hflag & hflag) != 0; };
    BM_ITER_MESH_INDEX (v, &iter, bm, BM_VERTS_OF_MESH, i) {
      set(SELECT_VERT, i, v->head, BM_ELEM_SELECT);
      set(HIDE_VERT, i, v->head, BM_ELEM_HIDDEN);
    }
    BM_ITER_MESH_INDEX (e, &iter, bm, BM_EDGES_OF_MESH, i) {
      set(SELECT_EDGE, i, e->head, BM_ELEM_SELECT);
      set(HIDE_EDGE, i, e->head, BM_ELEM_HIDDEN);
      set(UV_SEAM, i, e->head, BM_ELEM_SEAM);
      h.flags[SHARP_EDGE][i] = !BM_elem_flag_test(e, BM_ELEM_SMOOTH);
    }
    BM_ITER_MESH_INDEX (f, &iter, bm, BM_FACES_OF_MESH, i) {
      set(SELECT_POLY, i, f->head, BM_ELEM_SELECT);
      set(HIDE_POLY, i, f->head, BM_ELEM_HIDDEN);
      h.flags[SHARP_FACE][i] = !BM_elem_flag_test(f, BM_ELEM_SMOOTH);
    }
  }
  if (what & EXTRACT_UV) {
    const int cd_uv = CustomData_get_offset_named(&bm->ldata, CD_PROP_FLOAT2, "UVMap");
    h.uvs = cd_uv == -1 ? nullptr : reinterpret_cast<float(*)[2]>(sized(ex.uvs, h.corners_num));
    BMLoop *l;
    if (h.uvs) {
      BM_ITER_MESH (f, &iter, bm, BM_FACES_OF_MESH) {
        BMIter liter;
        BM_ITER_ELEM (l, &liter, f, BM_LOOPS_OF_FACE) {
          copy_v2_v2(h.uvs[BM_elem_index_get(l)], BM_ELEM_CD_GET_FLOAT_P(l, cd_uv));
        }
      }
    }
  }
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

