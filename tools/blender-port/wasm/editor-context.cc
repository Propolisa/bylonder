/* Blender's mesh editors without a window manager: a scene with one object in Edit Mode, found the way Blender's
 * context finds it (the context store), and operators registered by their own MESH_OT_* functions and run by their
 * own exec. The window manager's and depsgraph's updates have nothing to update here, so they do nothing. */
#include "BLI_listbase.h"
#include "BLI_math_matrix.h"
#include "BLI_math_matrix.hh"
#include "BLI_math_rotation.h"
#include "BLI_math_vector.h"
#include "BLI_math_base.h"
#include "CLG_log.h"
#include "BLF_api.hh"
#include "BKE_global.hh"
#include "BLI_string.h"
#include "BLI_rect.h"
#include "BKE_wm_runtime.hh"
#include "UI_view2d.hh"

#include "BKE_context.hh"
#include "BKE_editmesh.hh"
#include "BKE_layer.hh"
#include "BKE_lib_id.hh"
#include "BKE_unit.hh"
#include "BLT_translation.hh"
#include "BKE_mesh_types.hh"
#include "BKE_mesh_runtime.hh"
#include "BKE_object.hh"
#include "BKE_modifier.hh"
#include "BKE_object_types.hh"

#include "DEG_depsgraph.hh"
#include "DEG_depsgraph_build.hh"
#include "DEG_depsgraph_query.hh"

#include "DNA_layer_types.h"
#include "DNA_mesh_types.h"
#include "DNA_object_types.h"
#include "DNA_scene_types.h"
#include "DNA_view3d_types.h"
#include "DNA_screen_types.h"
#include "DNA_windowmanager_types.h"
#include "DNA_workspace_types.h"
#include "ED_space_api.hh"

#include "BKE_report.hh"
#include "BKE_screen.hh"
#include "DNA_key_types.h"
#include "DNA_modifier_types.h"
#include "ED_mesh.hh"
#include "ED_object.hh"
#include "ED_screen.hh"
#include "ED_view3d.hh"
#include "BKE_scene.hh"
#include "ED_select_utils.hh"
#include "ED_transform.hh"

#include "WM_api.hh"
#include "gizmo/WM_gizmo_api.hh"
#include "gizmo/WM_gizmo_types.hh"
#include "WM_types.hh"

#include "bmesh.hh"
#include "mesh_intern.hh"
#include "object_intern.hh"
#include "curve_intern.hh"
#include "wm_files.hh"
#include "MEM_guardedalloc.h"
#include "RNA_access.hh"
#include "RNA_enum_types.hh"
#include "RNA_prototypes.hh"
#include "rna-runtime.hh"
#include "extraction.hh"
#include "area.hh"

#include <algorithm>
#include <string>

using namespace blender;
using namespace blender::ed::mesh;
using namespace blender::ed::object;

#define EXPORT(name) extern "C" __attribute__((export_name(#name)))

/* Logging is set up first, as Blender's main sets it up. */
static const bool logging = (CLG_init(), true);

/* A scene holding one mesh object in Edit Mode, whose edit mesh owns a BMesh made by bm_from_arrays. */
struct EditContext {
  bContext *C;
  Vector<std::unique_ptr<bContextStore>> stores;
  Scene scene = {};
  ToolSettings tool_settings = {};
  ViewLayer view_layer = {};
  Base base = {};
  Object object = {};
  Mesh mesh = {};
  /* What evaluating an edit mesh without modifiers gives: a mesh that wraps it (ME_WRAPPER_TYPE_BMESH). */
  Mesh mesh_eval = {};
  /* The 3D View the operators act in once the editor gives its view (edit_context_view_set): its window and screen,
   * area, space and window region; without a region type, as in Blender's background mode, nothing is drawn. */
  BylonderArea view_area;
  wmWindow window = {};
  WorkSpaceInstanceHook workspace_hook = {};
  WorkSpaceLayout layout = {};
  bScreen screen = {};
  View3D v3d = {};
  ARegion region = {};
  RegionView3D rv3d = {};
  Extraction extraction;
  /* The edit mesh's final mesh when its object has modifiers (editbmesh_get_eval_cage). */
  ExtractionHeader evaluated = {};
};

EXPORT(edit_context_new) EditContext *edit_context_new(BMesh *bm)
{
  EditContext *ctx = MEM_new<EditContext>(__func__);
  ctx->mesh.runtime = MEM_new<bke::MeshRuntime>(__func__);
  ctx->mesh.runtime->edit_mesh = std::make_shared<BMEditMesh>();
  ctx->mesh.runtime->edit_mesh->bm = bm;
  ctx->mesh.runtime->edit_mesh->selectmode = bm->selectmode;
  /* As entering Edit Mode does (EDBM_mesh_make), for the operators that ray-cast the edit mesh (the knife). */
  BKE_editmesh_looptris_calc(ctx->mesh.runtime->edit_mesh.get());
  STRNCPY(ctx->mesh.id.name, "MEMesh");
  ctx->mesh_eval.runtime = MEM_new<bke::MeshRuntime>(__func__);
  ctx->mesh_eval.runtime->wrapper_type = ME_WRAPPER_TYPE_BMESH;
  ctx->mesh_eval.runtime->edit_mesh = ctx->mesh.runtime->edit_mesh;
  ctx->object.runtime = MEM_new<bke::ObjectRuntime>(__func__);
  ctx->object.runtime->data_eval = &ctx->mesh_eval.id;
  ctx->object.type = OB_MESH;
  ctx->object.mode = OB_MODE_EDIT;
  ctx->object.data = &ctx->mesh.id;
  STRNCPY(ctx->object.id.name, "OBMesh");
  ctx->base.object = &ctx->object;
  ctx->base.flag = BASE_SELECTED | BASE_ENABLED_AND_MAYBE_VISIBLE_IN_VIEWPORT | BASE_ENABLED_AND_VISIBLE_IN_DEFAULT_VIEWPORT;
  ctx->view_layer.runtime = MEM_new<ViewLayerRuntime>(__func__);
  BLI_addtail(&ctx->view_layer.object_bases, &ctx->base);
  ctx->view_layer.basact = &ctx->base;
  BLI_addtail(&ctx->scene.view_layers, &ctx->view_layer);
  ctx->tool_settings.selectmode = bm->selectmode;
  ctx->scene.toolsettings = &ctx->tool_settings;

  ctx->region.runtime = MEM_new<bke::ARegionRuntime>(__func__);

  ctx->C = CTX_create();
  CTX_wm_region_set(ctx->C, &ctx->region);
  CTX_data_scene_set(ctx->C, &ctx->scene);
  PointerRNA object_ptr = {&ctx->object.id, RNA_Object, &ctx->object};
  CTX_store_add(ctx->stores, "edit_object", &object_ptr);
  CTX_store_add(ctx->stores, "active_object", &object_ptr);
  bContextStore *store = CTX_store_add(ctx->stores, "object", &object_ptr);
  CTX_store_set(ctx->C, store);
  return ctx;
}

/* The context its operators run in. */
EXPORT(edit_context_C) bContext *edit_context_C(EditContext *ctx) { return ctx->C; }

EXPORT(edit_context_free) void edit_context_free(EditContext *ctx)
{
  CTX_free(ctx->C);
  BKE_object_free_derived_caches(&ctx->object);
  while (ModifierData *md = static_cast<ModifierData *>(BLI_pophead(&ctx->object.modifiers))) {
    BKE_modifier_free(md);
  }
  MEM_delete(ctx->region.runtime);
  MEM_delete(ctx->view_layer.runtime->object_bases_hash);
  MEM_delete(ctx->view_layer.runtime);
  BM_mesh_free(ctx->mesh.runtime->edit_mesh->bm);
  ctx->mesh.runtime->edit_mesh.reset();
  MEM_delete(ctx->mesh.runtime);
  MEM_delete(ctx->mesh_eval.runtime);
  MEM_delete(ctx->object.runtime);
  MEM_delete(ctx);
}

/* The edit mesh's BMesh, which may be a new one after an operator (as Undo replaces it). */
EXPORT(edit_context_bmesh) BMesh *edit_context_bmesh(EditContext *ctx) { return ctx->mesh.runtime->edit_mesh->bm; }
/* Replaces the edit mesh's BMesh, freeing the one it had, as loading an undo step does. */
EXPORT(edit_context_bmesh_set) void edit_context_bmesh_set(EditContext *ctx, BMesh *bm)
{
  BMEditMesh &em = *ctx->mesh.runtime->edit_mesh;
  BM_mesh_free(em.bm);
  em.bm = bm;
  bm->selectmode = em.selectmode;
}
EXPORT(edit_context_selectmode) int edit_context_selectmode(EditContext *ctx) { return ctx->tool_settings.selectmode; }
EXPORT(edit_context_selectmode_set) void edit_context_selectmode_set(EditContext *ctx, int selectmode)
{
  ctx->tool_settings.selectmode = selectmode;
  ctx->mesh.runtime->edit_mesh->selectmode = selectmode;
  ctx->mesh.runtime->edit_mesh->bm->selectmode = selectmode;
}
/* Refills the extraction by what changed (ExtractFlag) and gives its header. */
EXPORT(edit_mesh_extract) const ExtractionHeader *edit_mesh_extract(EditContext *ctx, int what)
{
  extraction_update(ctx->mesh.runtime->edit_mesh->bm, ctx->extraction, what);
  return &ctx->extraction.header;
}

/* EDBM_selectmode_flush: selection flushed from the elements of the select mode. */
EXPORT(edit_mesh_select_flush) void edit_mesh_select_flush(EditContext *ctx) { EDBM_selectmode_flush(ctx->mesh.runtime->edit_mesh.get()); }

/* port-override: EDBM_select_pick (editmesh_select.cc) once its view has found the element (htype and index, or -1
 * for none): the view and its picking stay in JS. UV select sync is off, so its UV selection is left out, and the
 * object has no material slots to make the face's active. */
EXPORT(edit_mesh_select_pick) bool edit_mesh_select_pick(EditContext *ctx, int htype, int index, int sel_op, bool deselect_all)
{
  BMEditMesh *em = ctx->mesh.runtime->edit_mesh.get();
  BMesh *bm = em->bm;
  BMElem *ele = nullptr;
  if (index >= 0) {
    BM_mesh_elem_table_ensure(bm, char(htype));
    ele = htype == BM_VERT ? reinterpret_cast<BMElem *>(BM_vert_at_index(bm, index)) :
          htype == BM_EDGE ? reinterpret_cast<BMElem *>(BM_edge_at_index(bm, index)) :
                             reinterpret_cast<BMElem *>(BM_face_at_index(bm, index));
  }
  bool changed = false;
  if (sel_op == SEL_OP_SET && (ele || deselect_all)) {
    EDBM_flag_disable_all(em, BM_ELEM_SELECT);
    changed = true;
  }
  if (!ele) {
    return changed;
  }
  BMFace *efa = htype == BM_FACE ? reinterpret_cast<BMFace *>(ele) : nullptr;
  switch (sel_op) {
    case SEL_OP_ADD:
      if (efa) {
        BM_mesh_active_face_set(bm, efa);
      }
      /* Deselected first so it becomes active even when it was selected. */
      BM_select_history_remove(bm, ele);
      BM_elem_select_set(bm, ele, false);
      BM_select_history_store(bm, ele);
      BM_elem_select_set(bm, ele, true);
      break;
    case SEL_OP_SUB:
      BM_select_history_remove(bm, ele);
      BM_elem_select_set(bm, ele, false);
      break;
    case SEL_OP_XOR:
      if (efa) {
        BM_mesh_active_face_set(bm, efa);
      }
      if (!BM_elem_flag_test(ele, BM_ELEM_SELECT)) {
        BM_select_history_store(bm, ele);
        BM_elem_select_set(bm, ele, true);
      }
      else {
        BM_select_history_remove(bm, ele);
        BM_elem_select_set(bm, ele, false);
      }
      break;
    case SEL_OP_SET:
      if (efa) {
        BM_mesh_active_face_set(bm, efa);
      }
      if (!BM_elem_flag_test(ele, BM_ELEM_SELECT)) {
        BM_select_history_store(bm, ele);
        BM_elem_select_set(bm, ele, true);
      }
      break;
  }
  EDBM_selectmode_flush(em);
  if (efa) {
    em->mat_nr = efa->mat_nr;
  }
  return true;
}

/* The object's matrix (column-major, Blender's axes), which operators read for world space (the 3D cursor). */
/* The edited object, whose modifier stack modifier_add and modifier_clear (modifier-api.cc) change. */
EXPORT(edit_context_object) Object *edit_context_object(EditContext *ctx) { return &ctx->object; }

/* Evaluates the object's modifiers on the edit mesh as Blender's depsgraph does in Edit Mode and extracts the final
 * mesh, which stays until the next evaluation; null without modifiers, when the edit mesh is the final mesh. */
EXPORT(edit_mesh_eval) const ExtractionHeader *edit_mesh_eval(EditContext *ctx)
{
  Object &ob = ctx->object;
  BKE_object_free_derived_caches(&ob);
  if (BLI_listbase_is_empty(&ob.modifiers)) {
    ob.runtime->data_eval = &ctx->mesh_eval.id;
    return nullptr;
  }
  Depsgraph *depsgraph = BKE_scene_ensure_depsgraph(nullptr, &ctx->scene, &ctx->view_layer);
  bke::editbmesh_get_eval_cage(depsgraph, &ctx->scene, &ob, ctx->mesh.runtime->edit_mesh.get(), &CD_MASK_BAREMESH);
  mesh_extraction(*BKE_object_get_editmesh_eval_final(&ob), ctx->evaluated);
  return &ctx->evaluated;
}

/* port-override: the 3D View the editor shows (ED_view3d_update_viewmat with Babylon's camera as its matrices): its view
 * and window matrices (Blender's axes, column-major), its size in pixels and whether it is a perspective view. Operators
 * then act in it as in Blender's window region, projecting the mouse as it does. */
static wmGizmoMap *gizmo_map_standin();
/* A 3D View's window region given its view (edit_context_view_set, main_view_set): area, space and region linked
 * once, the region's view set each time. */
void view3d_region_set(ScrArea &area, View3D &v3d, ARegion &region, RegionView3D &rv3d, const float *viewmat, const float *winmat, int winx,
                       int winy, bool is_persp)
{
  std::copy_n(viewmat, 16, &rv3d.viewmat[0][0]);
  std::copy_n(winmat, 16, &rv3d.winmat[0][0]);
  mul_m4_m4m4(rv3d.persmat, rv3d.winmat, rv3d.viewmat);
  invert_m4_m4(rv3d.persinv, rv3d.persmat);
  invert_m4_m4(rv3d.viewinv, rv3d.viewmat);
  mat4_normalized_to_quat(rv3d.viewquat, rv3d.viewmat);
  rv3d.is_persp = is_persp;
  rv3d.persp = is_persp ? RV3D_PERSP : RV3D_ORTHO;
  rv3d.viewcamtexcofac[0] = rv3d.viewcamtexcofac[1] = 1.0f;
  const float v1[3] = {rv3d.persmat[0][0], rv3d.persmat[1][0], rv3d.persmat[2][0]};
  const float v2[3] = {rv3d.persmat[0][1], rv3d.persmat[1][1], rv3d.persmat[2][1]};
  rv3d.pixsize = (2.0f / sqrtf(min_ff(len_squared_v3(v1), len_squared_v3(v2)))) / float(std::max(winx, winy));
  region.regiondata = &rv3d;
  region.regiontype = RGN_TYPE_WINDOW;
  region.winx = short(winx);
  region.winy = short(winy);
  BLI_rcti_init(&region.winrct, 0, winx - 1, 0, winy - 1);
  BLI_rcti_init(&area.totrct, 0, winx - 1, 0, winy - 1);
  if (BLI_listbase_is_empty(&area.spacedata)) {
    if (!region.runtime) {
      region.runtime = MEM_new<bke::ARegionRuntime>(__func__);
    }
    /* The editor's gizmo map (wm-gizmo-map.js) draws and runs the view's gizmos; the module's stands in for it
     * (WM_gizmomap_group_find below). */
    region.runtime->gizmo_map = gizmo_map_standin();
    area.spacetype = SPACE_VIEW3D;
    BLI_addtail(&area.spacedata, &v3d);
    BLI_addtail(&area.regionbase, &region);
  }
}

EXPORT(edit_context_view_set)
void edit_context_view_set(EditContext *ctx, const float *viewmat, const float *winmat, int winx, int winy, bool is_persp)
{
  ScrArea &area = ctx->view_area.area;
  if (BLI_listbase_is_empty(&area.spacedata)) {
    ctx->window.scene = &ctx->scene;
    ctx->window.workspace_hook = &ctx->workspace_hook;
    ctx->workspace_hook.act_layout = &ctx->layout;
    ctx->layout.screen = &ctx->screen;
    BLI_addtail(&ctx->screen.areabase, &area);
  }
  view3d_region_set(area, ctx->v3d, ctx->region, ctx->rv3d, viewmat, winmat, winx, winy, is_persp);
  CTX_wm_window_set(ctx->C, &ctx->window);
  CTX_wm_area_set(ctx->C, &area);
  CTX_wm_region_set(ctx->C, &ctx->region);
}

/* The gizmo map Bylonder's window manager keeps (wm-gizmo-map.js), as the module's operators see it: the group of
 * the active tool JS shows (edit_context_gizmo_group_set), the gizmo groups an operator asks for after it runs (its
 * redo gizmos, read by edit_context_gizmo_requested), and the mesh element the preselection gizmo has under the mouse
 * (edit_mesh_preselect_elem). */
static std::string gizmo_group_shown;
static std::string gizmo_groups_requested;
static BMElem *preselected = nullptr;

static wmGizmoMap *gizmo_map_standin()
{
  static char standin;
  return reinterpret_cast<wmGizmoMap *>(&standin);
}

EXPORT(edit_context_gizmo_group_set) void edit_context_gizmo_group_set(const char *idname) { gizmo_group_shown = idname; }
EXPORT(edit_context_gizmo_requested) const char *edit_context_gizmo_requested()
{
  static std::string requested;
  requested = gizmo_groups_requested;
  gizmo_groups_requested.clear();
  return requested.c_str();
}

namespace blender {

/* port-override: the stand-in gizmo map has one gizmo group, the one JS shows, with one gizmo; what an operator reads
 * of it is answered below (ED_view3d_gizmo_mesh_preselect_get_active). */
wmGizmoGroup *WM_gizmomap_group_find(wmGizmoMap * /*gzmap*/, const char *idname)
{
  static wmGizmoGroup group = {};
  static wmGizmo gizmo = {};
  if (gizmo_group_shown != idname || !STREQ(idname, "VIEW3D_GGT_mesh_preselect_elem")) {
    return nullptr;
  }
  group.gizmos.first = group.gizmos.last = &gizmo;
  return &group;
}
bool WM_gizmo_context_check_drawstep(const bContext * /*C*/, eWM_GizmoFlagMapDrawStep /*step*/) { return true; }
/* No gizmo runs modally in the module, and none of its groups is listed: the gizmos are Bylonder's. */
wmGizmo *WM_gizmomap_get_modal(const wmGizmoMap * /*gzmap*/) { return nullptr; }
const ListBaseT<wmGizmoGroup> *WM_gizmomap_group_list(wmGizmoMap * /*gzmap*/)
{
  static ListBaseT<wmGizmoGroup> none = {};
  return &none;
}

/* port-override: gizmo group types by name only, so an operator's request for one reaches JS, which draws it. */
wmGizmoGroupType *WM_gizmogrouptype_find(StringRef idname, bool /*quiet*/)
{
  static Map<std::string, std::unique_ptr<wmGizmoGroupType>> types;
  return types.lookup_or_add_cb(idname, [&]() {
    auto type = std::make_unique<wmGizmoGroupType>();
    type->idname = BLI_strdupn(idname.data(), idname.size());
    return type;
  }).get();
}
bool WM_gizmo_group_type_ensure_ptr(wmGizmoGroupType *gzgt)
{
  gizmo_groups_requested += std::string(gzgt->idname) + "\n";
  return true;
}
bool WM_gizmo_group_type_ensure(StringRef idname) { return WM_gizmo_group_type_ensure_ptr(WM_gizmogrouptype_find(idname, true)); }
void WM_gizmo_group_type_reinit_ptr(Main * /*bmain*/, wmGizmoGroupType *gzgt) { WM_gizmo_group_type_ensure_ptr(gzgt); }

/* port-override: the preselection gizmo is Bylonder's; its element is the one edit_mesh_preselect_elem found. */
void ED_view3d_gizmo_mesh_preselect_get_active(const bContext *C, const wmGizmo * /*gz*/, Base **r_base, BMElem **r_ele)
{
  ViewLayer *view_layer = CTX_data_view_layer(C);
  BKE_view_layer_synced_ensure(*CTX_data_main(C), CTX_data_scene(C), view_layer);
  *r_base = preselected ? BKE_view_layer_active_base_get(view_layer) : nullptr;
  *r_ele = preselected;
}

}  // namespace blender

/* port-override: the layouts of editmesh_preselect_edgering.cc's and editmesh_preselect_elem.cc's private structs,
 * whose geometry JS draws. */
struct PreSelEdgeRingLayout {
  float (*edges)[2][3];
  int edges_len;
  float (*verts)[3];
  int verts_len;
};
struct PreSelElemLayout {
  float (*edges)[2][3];
  int edges_len;
  float (*verts)[3];
  int verts_len;
  float (*preview_tris)[3][3];
  int preview_tris_len;
  float (*preview_lines)[2][3];
  int preview_lines_len;
};

/* Preselection geometry for JS, in object space: counts of edges, vertices, preview triangles and preview lines,
 * then their coordinates in that order. */
static Vector<float> preselection_geometry;
static const float *preselection_pack(float (*edges)[2][3], int edges_len, float (*verts)[3], int verts_len,
                                      float (*tris)[3][3], int tris_len, float (*lines)[2][3], int lines_len)
{
  preselection_geometry = {float(edges_len), float(verts_len), float(tris_len), float(lines_len)};
  const auto add = [](const void *data, int len) {
    preselection_geometry.extend(Span(static_cast<const float *>(data), data ? len : 0));
  };
  add(edges, edges_len * 6);
  add(verts, verts_len * 3);
  add(tris, tris_len * 9);
  add(lines, lines_len * 6);
  return preselection_geometry.data();
}

/* The Loop Cut tool's preview (gizmo_preselect_edgering_test_select): the edge ring from an edge with `cuts` cuts
 * (EDBM_preselect_edgering_update_from_edge), or nothing for -1. */
EXPORT(edit_mesh_preselect_edgering) const float *edit_mesh_preselect_edgering(EditContext *ctx, int edge_index, int cuts)
{
  BMesh *bm = ctx->mesh.runtime->edit_mesh->bm;
  EditMesh_PreSelEdgeRing *psel = EDBM_preselect_edgering_create();
  if (edge_index >= 0 && edge_index < bm->totedge) {
    BM_mesh_elem_table_ensure(bm, BM_EDGE);
    EDBM_preselect_edgering_update_from_edge(psel, bm, BM_edge_at_index(bm, edge_index), cuts, {});
  }
  PreSelEdgeRingLayout &ring = *reinterpret_cast<PreSelEdgeRingLayout *>(psel);
  const float *out = preselection_pack(ring.edges, ring.edges_len, ring.verts, ring.verts_len, nullptr, 0, nullptr, 0);
  EDBM_preselect_edgering_destroy(psel);
  return out;
}

/* The Poly Build tool's preselection (gizmo_preselect_elem_test_select, mirrored): the element under the mouse
 * (region pixels, y up) by EDBM_unified_findnearest_from_raycast, Ctrl creating and Shift deleting, and its
 * preview; it is the element the tool's operators then act on. */
EXPORT(edit_mesh_preselect_elem) const float *edit_mesh_preselect_elem(EditContext *ctx, int x, int y, int modifier)
{
  bContext *C = ctx->C;
  static EditMesh_PreSelElem *psel = EDBM_preselect_elem_create();
  const bool is_ctrl_pressed = (modifier & KM_CTRL) != 0;
  const bool is_shift_pressed = (modifier & KM_SHIFT) != 0;
  EDBM_preselect_action_set(psel, PRESELECT_ACTION_TRANSFORM);
  if (is_ctrl_pressed && !is_shift_pressed) {
    EDBM_preselect_action_set(psel, PRESELECT_ACTION_CREATE);
  }
  if (!is_ctrl_pressed && is_shift_pressed) {
    EDBM_preselect_action_set(psel, PRESELECT_ACTION_DELETE);
  }
  Vector<Base *> bases = BKE_view_layer_array_from_bases_in_edit_mode(*CTX_data_main(C), CTX_data_scene(C), CTX_data_view_layer(C), CTX_wm_view3d(C));
  ViewContext vc = em_setup_viewcontext(C);
  vc.mval[0] = x;
  vc.mval[1] = y;
  BMElem *best = nullptr;
  int base_index_vert = -1, base_index_edge = -1, base_index_face = -1;
  BMVert *eve_test;
  BMEdge *eed_test;
  BMFace *efa_test;
  if (EDBM_unified_findnearest_from_raycast(&vc, bases, false, true, &base_index_vert, &base_index_edge, &base_index_face,
                                            &eve_test, &eed_test, &efa_test))
  {
    if (EDBM_preselect_action_get(psel) == PRESELECT_ACTION_DELETE) {
      if (efa_test) {
        best = reinterpret_cast<BMElem *>(efa_test);
      }
    }
    else if (eed_test) {
      best = reinterpret_cast<BMElem *>(eed_test);
    }
    if (eve_test) {
      float vert_p_co[2], vert_co[3];
      const float mval_f[2] = {float(x), float(y)};
      mul_v3_m4v3(vert_co, bases[base_index_vert]->object->object_to_world().ptr(), eve_test->co);
      ED_view3d_project_v2(vc.region, vert_co, vert_p_co);
      if (len_v2v2(vert_p_co, mval_f) < 35) {
        best = reinterpret_cast<BMElem *>(eve_test);
      }
      if (!BM_vert_is_boundary(eve_test) && EDBM_preselect_action_get(psel) != PRESELECT_ACTION_DELETE) {
        best = reinterpret_cast<BMElem *>(eve_test);
      }
    }
  }
  preselected = best;
  BMesh *bm = ctx->mesh.runtime->edit_mesh->bm;
  if (best) {
    const int mval[2] = {x, y};
    EDBM_preselect_elem_update_from_single(psel, bm, best, {});
    EDBM_preselect_elem_update_preview(psel, &vc, bm, best, mval);
  }
  else {
    EDBM_preselect_elem_clear(psel);
    EDBM_preselect_preview_clear(psel);
  }
  PreSelElemLayout &elem = *reinterpret_cast<PreSelElemLayout *>(psel);
  return preselection_pack(elem.edges, elem.edges_len, elem.verts, elem.verts_len, elem.preview_tris, elem.preview_tris_len,
                           elem.preview_lines, elem.preview_lines_len);
}

/* The text the last operator showed in the view's header (ED_area_status_text), or null. */
EXPORT(edit_context_status) const char *edit_context_status(EditContext *ctx)
{
  return ctx->view_area.status.empty() ? nullptr : ctx->view_area.status.c_str();
}

/* The 3D cursor of the scene the edited object is in (scene.cursor), which operators place things at. */
EXPORT(edit_context_cursor) float *edit_context_cursor(EditContext *ctx) { return ctx->scene.cursor.location; }

EXPORT(edit_context_object_matrix_set) void edit_context_object_matrix_set(EditContext *ctx, const float *object_to_world)
{
  bke::ObjectRuntime &runtime = *ctx->object.runtime;
  std::copy_n(object_to_world, 16, runtime.object_to_world.base_ptr());
  runtime.world_to_object = math::invert(runtime.object_to_world);
}

/* Operators, registered by Blender's own registration functions through the window manager (WM_operatortype_append),
 * by the index JS finds them at (operator_name). */
namespace blender {
void wm_operatortypes_register();
}
namespace blender::ed::transform {
void keymap_transform(wmKeyConfig *keyconf);
}
namespace blender {
void gesture_straightline_modal_keymap(wmKeyConfig *keyconf);
}

static Vector<wmOperatorType *> &operators()
{
  /* As WM_init registers them: the window manager's, every space's with their operators and gizmos, then macros. */
  static Vector<wmOperatorType *> table = [] {
    wm_operatortypes_register();
    ED_spacetypes_init();
    ED_spacemacros_init();
    ed::transform::keymap_transform(nullptr);
    knifetool_modal_keymap(nullptr);
    gesture_straightline_modal_keymap(nullptr);
    Vector<wmOperatorType *> types;
    for (wmOperatorType *ot : WM_operatortypes_registered_get()) {
      types.append(ot);
    }
    return types;
  }();
  return table;
}

void operators_register() { operators(); }

static wmOperatorType *operator_type(int index) { return operators()[index]; }

EXPORT(operator_count) int operator_count() { return int(operators().size()); }
/* Whether an operator runs without a modal session (has exec), as a menu or a script calls it. */
EXPORT(operator_has_exec) bool operator_has_exec(int index) { return operators()[index]->exec != nullptr; }
/* An operator's idname as Blender's C code has it (MESH_OT_subdivide). */
EXPORT(operator_name) const char *operator_name(int index) { return operators()[index]->idname; }

EXPORT(operator_new) wmOperator *operator_new(int type) { return operator_create(operator_type(type)); }
EXPORT(operator_free) void operator_free(wmOperator *op) { operator_destroy(op); }

/* Sets a property: numbers (len of them), or a string or enum identifiers. */
EXPORT(operator_set) bool operator_set(wmOperator *op, const char *name, const double *numbers, int len, const char *text)
{
  const bool set = operator_property_set(op->ptr, name, numbers, len, text);
  if (set && strchr(name, '.')) {
    operator_macro_fill(op);
  }
  return set;
}

EXPORT(operator_macro_debug) const char *operator_macro_debug(wmOperator *op)
{
  static std::string json;
  json = "[";
  for (wmOperator *opm = static_cast<wmOperator *>(op->macro.first); opm; opm = opm->next) {
    json += operator_values_json(opm->ptr) + ",";
  }
  return (json += "]").c_str();
}
/* The values the operator ran with, as JSON (operator_values_json). */
EXPORT(operator_values) const char *operator_values(wmOperator *op)
{
  static std::string json;
  json = operator_values_json(op->ptr);
  return json.c_str();
}

/* The message of the last report an operator made for its user (as Blender's status bar shows it), or null. */
EXPORT(operator_report) const char *operator_report(wmOperator *op)
{
  const Report *report = BKE_reports_last_displayable(op->reports);
  return report ? report->message : nullptr;
}

/* An enum property's items as the operator's UI lists them in a context, as "identifier\tname" lines; separators and
 * headings are left out. */
EXPORT(operator_enum_items) const char *operator_enum_items(bContext *C, int type, const char *name)
{
  static std::string text;
  wmOperator *op = operator_create(operator_type(type));
  PropertyRNA *prop = RNA_struct_find_property(op->ptr, name);
  const EnumPropertyItem *items = nullptr;
  int total = 0;
  bool free = false;
  text.clear();
  if (prop) {
    RNA_property_enum_items(C, op->ptr, prop, &items, &total, &free);
  }
  for (int i = 0; i < total; i++) {
    if (items[i].identifier[0]) {
      text += std::string(items[i].identifier) + '\t' + items[i].name + '\n';
    }
  }
  if (free) {
    MEM_delete(const_cast<EnumPropertyItem *>(items));
  }
  operator_destroy(op);
  return text.c_str();
}

/* Whether an operator polls, as Blender greys out a menu entry that does not. */
EXPORT(operator_poll) bool operator_poll(bContext *C, int type)
{
  wmOperatorType *ot = operator_type(type);
  return !ot->poll || ot->poll(C);
}

/* Polls and runs an operator's exec: its wmOperatorStatus flags, or 0 when it does not poll or has no exec. */
EXPORT(operator_exec) int operator_exec(bContext *C, wmOperator *op)
{
  if (!op->type->exec || (op->type->poll && !op->type->poll(C))) {
    return 0;
  }
  return int(op->type->exec(C, op));
}

/* The event an operator's invoke or modal gets (wmEvent): its type and value (wmEventType, KM_PRESS...), where it is in
 * the context's region (Blender's y up), its modifier keys (wmEventModifierFlag), its text and the previous press. */
static wmEvent *last_event = nullptr;
/* Where the press a drag began with was (region pixels, y up), for the event wm_event_set made last
 * (WM_event_drag_start_xy reads it). */
EXPORT(wm_event_press_set) void wm_event_press_set(bContext *C, int x, int y)
{
  const ARegion *region = CTX_wm_region(C);
  const int2 origin = region ? int2(region->winrct.xmin, region->winrct.ymin) : int2(0);
  last_event->prev_press_xy[0] = x + origin.x;
  last_event->prev_press_xy[1] = y + origin.y;
}
EXPORT(wm_event_set)
wmEvent *wm_event_set(bContext *C, int type, int val, int x, int y, int modifier, const char *utf8, int prev_type, int prev_val)
{
  static wmEvent event;
  event = {};
  last_event = &event;
  event.type = wmEventType(type);
  event.val = short(val);
  const ARegion *region = CTX_wm_region(C);
  const int2 origin = region ? int2(region->winrct.xmin, region->winrct.ymin) : int2(0);
  event.mval[0] = x;
  event.mval[1] = y;
  event.xy[0] = x + origin.x;
  event.xy[1] = y + origin.y;
  event.modifier = wmEventModifierFlag(modifier);
  STRNCPY(event.utf8_buf, utf8);
  event.prev_type = wmEventType(prev_type);
  event.prev_val = short(prev_val);
  event.prev_press_type = wmEventType(prev_type);
  event.prev_xy[0] = event.prev_press_xy[0] = event.xy[0];
  event.prev_xy[1] = event.prev_press_xy[1] = event.xy[1];
  /* The window's event state follows, as wm_event_add_ghostevent keeps it: where the pointer is and the keys held. */
  const wmWindow *win = CTX_wm_window(C);
  if (win && win->runtime && win->runtime->eventstate) {
    copy_v2_v2_int(win->runtime->eventstate->xy, event.xy);
    win->runtime->eventstate->modifier = event.modifier;
  }
  return &event;
}

/* The operator a modal handler was added for since the last call (WM_event_add_modal_handler), or null. */
static wmOperator *modal_added = nullptr;
EXPORT(operator_modal_added) wmOperator *operator_modal_added()
{
  wmOperator *op = modal_added;
  modal_added = nullptr;
  return op;
}

/* Polls and runs an operator's invoke (or its exec when it has none) with an event: its wmOperatorStatus flags, or 0
 * when it does not poll. One that returns OPERATOR_RUNNING_MODAL gets the following events through operator_modal. */
EXPORT(operator_invoke) int operator_invoke(bContext *C, wmOperator *op, const wmEvent *event)
{
  if (op->type->poll && !op->type->poll(C)) {
    return 0;
  }
  op->flag |= OP_IS_INVOKE;
  return int(op->type->invoke ? op->type->invoke(C, op, event) : op->type->exec ? op->type->exec(C, op) : 0);
}

/* The name of an operator's modal keymap ("Transform Modal Map"), whose items Bylonder's window manager matches events
 * to, or an empty string. */
/* The operator whose modal keymap applies: a macro's running operator (wm_event_modalkeymap_ensure). */
static wmOperator *modal_operator(wmOperator *op) { return op->opm ? op->opm : op; }
EXPORT(operator_modal_keymap) const char *operator_modal_keymap(wmOperator *op)
{
  wmKeyMap *keymap = modal_operator(op)->type->modalkeymap;
  return keymap ? keymap->idname : "";
}

/* An operator's type flags (wmOperatorTypeFlag: OPTYPE_UNDO when a run is an undo step). */
EXPORT(operator_type_flag) int operator_type_flag(wmOperator *op) { return op->type->flag; }

EXPORT(operator_modal) int operator_modal(bContext *C, wmOperator *op, const wmEvent *event)
{
  return int(op->type->modal(C, op, event));
}

/* Whether a modal operator's modal keymap lets an item through now (wmKeyMap.poll_modal_item), and the value of its
 * item by identifier (-1 when it has none). */
EXPORT(operator_modal_item) int operator_modal_item(wmOperator *op, const char *identifier)
{
  op = modal_operator(op);
  wmKeyMap *keymap = op->type->modalkeymap;
  if (!keymap || !keymap->modal_items) {
    return -1;
  }
  for (const EnumPropertyItem *item = static_cast<const EnumPropertyItem *>(keymap->modal_items); item->identifier; item++) {
    if (STREQ(item->identifier, identifier)) {
      return !keymap->poll_modal_item || keymap->poll_modal_item(op, item->value) ? item->value : -1;
    }
  }
  return -1;
}

/* The menu the last operator called (WM_menu_name_call), which Bylonder's window manager opens, cleared by asking. */
static std::string menu_called;
EXPORT(operator_menu_called) const char *operator_menu_called()
{
  static std::string name;
  name = std::exchange(menu_called, "");
  return name.c_str();
}

/* What the operators reach of Blender beyond the module. */

namespace blender {

/* port-override: Blender's menus are drawn by Bylonder's window manager (JS), which opens the menu named here. */
void WM_menu_name_call(bContext * /*C*/, const char *menu_name, wm::OpCallContext /*context*/) { menu_called = menu_name; }

/* port-override: Bylonder's window manager keeps the modal handler (JS); it learns of it by operator_modal_added. */
wmEventHandler_Op *WM_event_add_modal_handler(bContext * /*C*/, wmOperator *op)
{
  /* As wm_event_system.cc does for a macro's operator: the handler runs the mother macro, whose opm is the one running. */
  if (op->opm) {
    op->opm->opm = op;
    op = op->opm;
  }
  modal_added = op;
  return reinterpret_cast<wmEventHandler_Op *>(op);
}

/* As wm_keymap.cc defines them for modal keymaps, which keep their items' enum here; the items' keys are Blender's
 * keymap data in JS, which matches events to them. */
static Vector<std::unique_ptr<wmKeyMap>> &modal_keymaps()
{
  static Vector<std::unique_ptr<wmKeyMap>> keymaps;
  return keymaps;
}
wmKeyMap *WM_modalkeymap_find(wmKeyConfig * /*keyconf*/, const char *idname)
{
  for (std::unique_ptr<wmKeyMap> &keymap : modal_keymaps()) {
    if (STREQ(keymap->idname, idname)) {
      return keymap.get();
    }
  }
  return nullptr;
}
wmKeyMap *WM_modalkeymap_ensure(wmKeyConfig *keyconf, const char *idname, const EnumPropertyItem *items)
{
  wmKeyMap *keymap = WM_modalkeymap_find(keyconf, idname);
  if (!keymap) {
    modal_keymaps().append(std::make_unique<wmKeyMap>());
    keymap = modal_keymaps().last().get();
    STRNCPY(keymap->idname, idname);
    keymap->flag = KEYMAP_MODAL;
  }
  keymap->modal_items = items;
  return keymap;
}
void WM_modalkeymap_assign(wmKeyMap *km, const char *opname)
{
  if (wmOperatorType *ot = WM_operatortype_find(opname, true)) {
    ot->modalkeymap = km;
  }
}
wmKeyMap *WM_keymap_active(const wmWindowManager * /*wm*/, wmKeyMap *keymap) { return keymap; }

/* As object_edit.cc defines them; object_edit.cc comes with the rest of Blender's object editing. */
Object *ed::object::context_object(const bContext *C)
{
  return static_cast<Object *>(CTX_data_pointer_get_type(C, "object", RNA_Object).data);
}
Object *ed::object::context_active_object(const bContext *C)
{
  Object *ob = nullptr;
  if (C) {
    ob = context_object(C);
    if (!ob) {
      ob = CTX_data_active_object(C);
    }
  }
  return ob;
}

/* As object_shapekey.cc checks a mesh: an operator that moves vertices refuses a locked active shape key. */
bool ed::object::shape_key_report_if_locked(const Object *obedit, ReportList *reports)
{
  const KeyBlock *key_block = obedit->type == OB_MESH ? ED_mesh_get_edit_shape_key(id_cast<Mesh *>(obedit->data)) : nullptr;
  if (key_block && (key_block->flag & KEYBLOCK_LOCKED_SHAPE) != 0) {
    if (reports) {
      BKE_reportf(reports, RPT_ERROR, "The active shape key of %s is locked", obedit->id.name + 2);
    }
    return true;
  }
  return false;
}

/* port-override: Blender's poll (screen_ops.cc), which comes with Blender's screens. */
bool ED_operator_editmesh(bContext *C)
{
  Object *obedit = CTX_data_edit_object(C);
  return obedit && obedit->type == OB_MESH && BKE_editmesh_from_object(obedit);
}
bool ED_operator_editable_mesh(bContext *C) { return ED_operator_editmesh(C); }
/* As wm_operators.cc defines it, for operators run by their exec, which is how the editor runs them: the grid scale
 * applies to an invoked operator's distances only. */
void WM_operator_view3d_unit_defaults(bContext * /*C*/, wmOperator *op) { BLI_assert(!(op->flag & OP_IS_INVOKE)); }

/* As view3d_draw.cc defines it. */
float ED_scene_grid_scale(const Scene *scene, const char **r_grid_unit)
{
  if (scene->unit.system) {
    const void *usys;
    int len;
    BKE_unit_system_get(scene->unit.system, B_UNIT_LENGTH, &usys, &len);
    if (usys) {
      int i = BKE_unit_base_get(usys);
      if (r_grid_unit) {
        *r_grid_unit = IFACE_(BKE_unit_display_name_get(usys, i));
      }
      return float(BKE_unit_scalar_get(usys, i)) / scene->unit.scale_length;
    }
  }
  return 1.0f;
}


/* port-override: the editor draws its own status bar for its tools, so what operators put there goes nowhere. */
WorkspaceStatus::WorkspaceStatus(bContext * /*C*/) : workspace_(nullptr), wm_(nullptr) {}
void WorkspaceStatus::item(std::string /*text*/, int /*icon1*/, int /*icon2*/) {}
void WorkspaceStatus::separator(float /*factor*/) {}
void WorkspaceStatus::item_bool(std::string /*text*/, bool /*inverted*/, int /*icon1*/, int /*icon2*/) {}
void WorkspaceStatus::range(std::string /*text*/, int /*icon1*/, int /*icon2*/) {}
void WorkspaceStatus::opmodal(std::string /*text*/, const wmOperatorType * /*ot*/, int /*propvalue*/, bool /*inverted*/) {}

/* As screen_ops.cc defines them: until the editor gives its view the context has no window, screen or area, so
 * operators that need one do not run, as in Blender's background mode. */
bool ED_operator_screenactive(bContext *C) { return CTX_wm_window(C) && CTX_wm_screen(C); }
bool ED_operator_regionactive(bContext *C) { return ED_operator_screenactive(C) && CTX_wm_region(C); }
bool ED_operator_areaactive(bContext *C) { return ED_operator_screenactive(C) && CTX_wm_area(C); }
bool ED_operator_active_screen_and_scene(bContext *C)
{
  if (!ED_operator_screenactive(C)) {
    return false;
  }
  if (CTX_wm_space_seq(C) != nullptr) {
    return CTX_data_sequencer_scene(C) != nullptr;
  }
  return CTX_data_scene(C) != nullptr;
}
static bool ed_spacetype_test(bContext *C, int type)
{
  const ScrArea *area = CTX_wm_area(C);
  return area && area->spacetype == type;
}
bool ED_operator_view3d_active(bContext *C) { return ed_spacetype_test(C, SPACE_VIEW3D); }
bool ED_operator_editmesh_view3d(bContext *C) { return ED_operator_editmesh(C) && ED_operator_view3d_active(C); }
bool ED_operator_sequencer_active(bContext *C) { return ed_spacetype_test(C, SPACE_SEQ) && CTX_data_sequencer_scene(C) != nullptr; }
bool ED_operator_region_view3d_active(bContext *C)
{
  if (CTX_wm_region_view3d(C)) {
    return true;
  }
  CTX_wm_operator_poll_msg_set(C, "Expected a view3d region");
  return false;
}
bool ED_operator_object_active_only_from_view_layer(bContext *C)
{
  Main &bmain = *CTX_data_main(C);
  Scene *scene = CTX_data_scene(C);
  ViewLayer *view_layer = CTX_data_view_layer(C);
  BKE_view_layer_synced_ensure(bmain, scene, view_layer);
  return BKE_view_layer_active_object_get(view_layer) != nullptr;
}

/* port-override: as screen_edit.cc's, for Bylonder's window, whose area under the pointer is the context's: active while
 * the pointer (the window's event state) is in the context's region. */
int ED_screen_area_active(const bContext *C)
{
  const wmWindow *win = CTX_wm_window(C);
  const ARegion *region = CTX_wm_region(C);
  return win && win->runtime && region && CTX_wm_area(C) && BLI_rcti_isect_pt_v(&region->winrct, win->runtime->eventstate->xy);
}

/* As screen_ops.cc defines it. */
bool ED_operator_scene_editable(bContext *C)
{
  Scene *scene = CTX_data_scene(C);
  return scene && BKE_id_is_editable(CTX_data_main(C), &scene->id);
}
/* port-override: the 3D View the operator needs is the editor's own, whose picking runs in JS. */
bool ED_operator_editmesh_region_view3d(bContext *C) { return ED_operator_editmesh(C); }

/* port-override: Bylonder draws the tools' gizmos (Spin, Bisect), so their gizmo group types are not kept. */
wmGizmoGroupType *blender::WM_gizmogrouptype_append(void (* /*wtfunc*/)(wmGizmoGroupType *))
{
  static wmGizmoGroupType type = {};
  return &type;
}

/* As view3d_context.cc defines it, for the region the context has: without its view (regiondata), sorting by view axis
 * reports that there is none. */
RegionView3D *ED_view3d_context_rv3d(bContext *C)
{
  ARegion *region = CTX_wm_region(C);
  return region ? static_cast<RegionView3D *>(region->regiondata) : nullptr;
}

/* As view3d_select.cc defines them; the rest of the 3D View stays in JS. */
ViewContext ED_view3d_viewcontext_init(bContext *C, Depsgraph *depsgraph)
{
  ViewContext vc = {};
  vc.C = C;
  vc.region = CTX_wm_region(C);
  vc.bmain = CTX_data_main(C);
  vc.depsgraph = depsgraph;
  vc.scene = CTX_data_scene(C);
  vc.view_layer = CTX_data_view_layer(C);
  vc.v3d = CTX_wm_view3d(C);
  vc.win = CTX_wm_window(C);
  vc.rv3d = CTX_wm_region_view3d(C);
  vc.obact = CTX_data_active_object(C);
  vc.obedit = CTX_data_edit_object(C);
  return vc;
}
void ED_view3d_viewcontext_init_object(ViewContext *vc, Object *obact)
{
  vc->obact = obact;
  if (vc->obedit) {
    vc->obedit = obact;
    if (vc->em) {
      vc->em = BKE_editmesh_from_object(vc->obedit);
    }
  }
}

/* Blender's globals, defined as blender.cc and rna_access.cc define them: their types' member defaults are Blender's
 * defaults. (blf.cc, built into the module with Blender's fonts, defines blf_mono_font.) */
Global G;
UserDef U;
extern const PointerRNA PointerRNA_NULL = {};

/* Marks the properties after it as advanced in Blender's UI. */
void WM_operatortype_props_advanced_begin(wmOperatorType * /*ot*/) {}

/* No window or view to update. */
void ED_workspace_status_text(bContext * /*C*/, const char * /*str*/) {}
void ED_region_tag_redraw(ARegion * /*region*/) {}
/* port-override: no depsgraph to flush tags through, so they stay on the ID (`recalc`), where the editor reads what an
 * operator changed. */
void DEG_id_tag_update(ID *id, unsigned int flags)
{
  if (id) {
    id->recalc |= flags;
  }
}
void DEG_id_tag_update_ex(Main * /*bmain*/, ID *id, unsigned int flags) { DEG_id_tag_update(id, flags); }
void WM_main_add_notifier(uint /*type*/, void * /*reference*/) {}
void WM_event_add_notifier(const bContext * /*C*/, uint /*type*/, void * /*reference*/) {}
void WM_event_add_notifier_ex(wmWindowManager * /*wm*/, const wmWindow * /*win*/, uint /*type*/, void * /*reference*/) {}

}  // namespace blender
