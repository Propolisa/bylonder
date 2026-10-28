/* Blender's mesh editors without a window manager: a scene with one object in Edit Mode, found the way Blender's
 * context finds it (the context store), and operators registered by their own MESH_OT_* functions and run by their
 * own exec. The window manager's and depsgraph's updates have nothing to update here, so they do nothing. */
#include "BLI_listbase.h"
#include "BLI_math_matrix.h"
#include "BLI_math_matrix.hh"
#include "CLG_log.h"
#include "BLF_api.hh"
#include "BKE_global.hh"
#include "BLI_string.h"
#include "BLI_rect.h"
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
#include "MEM_guardedalloc.h"
#include "RNA_access.hh"
#include "RNA_prototypes.hh"
#include "operator-properties.hh"
#include "extraction.hh"

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
  /* The region an operator draws in; without a type, as in Blender's background mode, it draws nothing. Its view
   * (regiondata) is set once the editor gives one. */
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

/* port-override: the 3D View's orientation (its view matrix, Blender's axes, column-major) for what operators do along
 * the view (sorting by view axis); the projection stays with Babylon's camera. */
EXPORT(edit_context_view_set) void edit_context_view_set(EditContext *ctx, const float *viewmat)
{
  std::copy_n(viewmat, 16, &ctx->rv3d.viewmat[0][0]);
  invert_m4_m4(ctx->rv3d.viewinv, ctx->rv3d.viewmat);
  ctx->region.regiondata = &ctx->rv3d;
}

EXPORT(edit_context_object_matrix_set) void edit_context_object_matrix_set(EditContext *ctx, const float *object_to_world)
{
  bke::ObjectRuntime &runtime = *ctx->object.runtime;
  std::copy_n(object_to_world, 16, runtime.object_to_world.base_ptr());
  runtime.world_to_object = math::invert(runtime.object_to_world);
}

/* Operators, each registered by Blender's own registration function when first used. */

struct OperatorDefinition {
  const char *name;
  void (*define)(wmOperatorType *);
  wmOperatorType *type = nullptr;
};

/* Operators registered through WM_operatortype_append (the transform operators), defined as they are appended. */
static Vector<OperatorDefinition> &appended_operators()
{
  static Vector<OperatorDefinition> appended;
  return appended;
}

void blender::WM_operatortype_append(void (*opfunc)(wmOperatorType *ot))
{
  wmOperatorType *type = MEM_new<wmOperatorType>(__func__);
  type->srna = operator_properties_new("");
  opfunc(type);
  type->srna->identifier = type->idname;
  appended_operators().append({type->idname, opfunc, type});
}

static Vector<OperatorDefinition> &operators()
{
  static Vector<OperatorDefinition> table = [] {
    Vector<OperatorDefinition> table = {
#define OPERATOR(define) {#define, define},
#include "operators.inc"
#undef OPERATOR
    };
    ed::transform::transform_operatortypes();
    table.extend(appended_operators());
    return table;
  }();
  return table;
}

static wmOperatorType *operator_type(int index)
{
  OperatorDefinition &def = operators()[index];
  if (!def.type) {
    def.type = MEM_new<wmOperatorType>(__func__);
    def.type->srna = operator_properties_new(def.name);
    def.define(def.type);
  }
  return def.type;
}

EXPORT(operator_count) int operator_count() { return int(operators().size()); }
/* The name of an operator's registration function (MESH_OT_subdivide), which is its idname. */
EXPORT(operator_name) const char *operator_name(int index) { return operators()[index].name; }

EXPORT(operator_new) wmOperator *operator_new(int type)
{
  wmOperator *op = MEM_new<wmOperator>(__func__);
  op->type = operator_type(type);
  STRNCPY(op->idname, op->type->idname);
  op->ptr = MEM_new<PointerRNA>(__func__, PointerRNA{nullptr, op->type->srna, operator_values_new()});
  op->reports = MEM_new<ReportList>(__func__);
  BKE_reports_init(op->reports, RPT_STORE);
  return op;
}

EXPORT(operator_free) void operator_free(wmOperator *op)
{
  operator_values_free(op->ptr->data);
  MEM_delete(op->ptr);
  BKE_reports_free(op->reports);
  MEM_delete(op->reports);
  MEM_delete(op);
}

/* Sets a property: numbers (len of them) or an enum item's identifier. */
EXPORT(operator_set) bool operator_set(wmOperator *op, const char *name, const double *numbers, int len, const char *enum_identifier)
{
  return operator_property_set(op->ptr, name, numbers, len, enum_identifier);
}

/* The message of the last report an operator made for its user (as Blender's status bar shows it), or null. */
EXPORT(operator_report) const char *operator_report(wmOperator *op)
{
  const Report *report = BKE_reports_last_displayable(op->reports);
  return report ? report->message : nullptr;
}

/* An enum property's items as the operator's UI lists them in a context (its item function, when it has one), as
 * "identifier\tname" lines; separators and headings are left out. */
EXPORT(operator_enum_items) const char *operator_enum_items(bContext *C, int type, const char *name)
{
  static std::string text;
  wmOperatorType *ot = operator_type(type);
  PointerRNA ptr = {nullptr, ot->srna, operator_values_new()};
  PropertyRNA *prop = RNA_struct_find_property(&ptr, name);
  bool free = false;
  const EnumPropertyItem *items = prop->itemf ? prop->itemf(C, &ptr, prop, &free) : prop->items;
  text.clear();
  for (const EnumPropertyItem *item = items; item && item->identifier; item++) {
    if (item->identifier[0]) {
      text += std::string(item->identifier) + '\t' + item->name + '\n';
    }
  }
  if (free) {
    MEM_delete(items);
  }
  operator_values_free(ptr.data);
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

/* What the operators reach of Blender beyond the module. */

namespace blender {

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

/* As view2d.cc defines it: transform reads the region's 2D view when the context has no 3D View. */
void ui::view2d_view_to_region_m4(const View2D *v2d, float matrix[4][4])
{
  rctf mask;
  unit_m4(matrix);
  BLI_rctf_rcti_copy(&mask, &v2d->mask);
  BLI_rctf_transform_calc_m4_pivot_min(&v2d->cur, &mask, matrix);
}

/* As area.cc defines it for no area, as when transform runs in Blender's background mode; the editor shows the
 * header text itself. */
void ED_area_status_text(ScrArea *area, const char * /*str*/) { BLI_assert(area == nullptr); }

/* port-override: the editor draws its own status bar for its tools, so what operators put there goes nowhere. */
WorkspaceStatus::WorkspaceStatus(bContext * /*C*/) : workspace_(nullptr), wm_(nullptr) {}
void WorkspaceStatus::item(std::string /*text*/, int /*icon1*/, int /*icon2*/) {}
void WorkspaceStatus::separator(float /*factor*/) {}
void WorkspaceStatus::item_bool(std::string /*text*/, bool /*inverted*/, int /*icon1*/, int /*icon2*/) {}
void WorkspaceStatus::range(std::string /*text*/, int /*icon1*/, int /*icon2*/) {}
void WorkspaceStatus::opmodal(std::string /*text*/, const wmOperatorType * /*ot*/, int /*propvalue*/, bool /*inverted*/) {}

/* As screen_ops.cc defines them: the editor's context has no window, screen or area, so operators that need one do
 * not run, as in Blender's background mode. */
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

/* As screen_ops.cc defines it. */
bool ED_operator_scene_editable(bContext *C)
{
  Scene *scene = CTX_data_scene(C);
  return scene && BKE_id_is_editable(CTX_data_main(C), &scene->id);
}
/* port-override: the 3D View the operator needs is the editor's own, whose picking runs in JS. */
bool ED_operator_editmesh_region_view3d(bContext *C) { return ED_operator_editmesh(C); }

/* port-override: the module has no depsgraph. Each ID is its own evaluated copy, and the editor evaluates modifiers
 * itself when they change (edit_mesh_eval, modifier_object_eval): the depsgraph is a token holding the scene it was
 * asked for, and the queries depsgraph_query.cc would answer from a graph answer from it. */
struct NoDepsgraph {
  Main *bmain;
  Scene *scene;
  ViewLayer *view_layer;
};
static const NoDepsgraph &no_depsgraph(const Depsgraph *depsgraph) { return *reinterpret_cast<const NoDepsgraph *>(depsgraph); }
Depsgraph *BKE_scene_ensure_depsgraph(Main *bmain, Scene *scene, ViewLayer *view_layer)
{
  static NoDepsgraph token;
  token = {bmain, scene, view_layer};
  return reinterpret_cast<Depsgraph *>(&token);
}
void DEG_make_active(Depsgraph * /*depsgraph*/) {}
bool DEG_is_active(const Depsgraph * /*depsgraph*/) { return true; }
void BKE_scene_graph_evaluated_ensure(Depsgraph * /*depsgraph*/, Main * /*bmain*/) {}
void DEG_id_type_tag(Main * /*bmain*/, short /*id_type*/) {}
void DEG_relations_tag_update(Main * /*bmain*/) {}
Main *DEG_get_bmain(const Depsgraph *graph) { return no_depsgraph(graph).bmain; }
Scene *DEG_get_input_scene(const Depsgraph *graph) { return no_depsgraph(graph).scene; }
ViewLayer *DEG_get_input_view_layer(const Depsgraph *graph) { return no_depsgraph(graph).view_layer; }
Scene *DEG_get_evaluated_scene(const Depsgraph *graph) { return no_depsgraph(graph).scene; }
ViewLayer *DEG_get_evaluated_view_layer(const Depsgraph *graph) { return no_depsgraph(graph).view_layer; }
eEvaluationMode DEG_get_mode(const Depsgraph * /*graph*/) { return DAG_EVAL_VIEWPORT; }
float DEG_get_ctime(const Depsgraph *graph) { return BKE_scene_ctime_get(no_depsgraph(graph).scene); }
ID *DEG_get_evaluated_id(const Depsgraph * /*depsgraph*/, ID *id) { return id; }
const ID *DEG_get_evaluated_id(const Depsgraph * /*depsgraph*/, const ID *id) { return id; }
/* No graph, so none of its evaluation to trace or count. */
uint64_t DEG_get_update_count(const Depsgraph * /*depsgraph*/) { return 0; }
void DEG_debug_print_eval(Depsgraph * /*depsgraph*/, const char * /*function_name*/, const char * /*object_name*/, const void * /*object_address*/) {}
/* No graph, so no custom data any of its evaluations asked for. */
void DEG_get_customdata_mask_for_object(const Depsgraph * /*graph*/, Object * /*object*/, CustomData_MeshMasks * /*r_mask*/) {}

/* As depsgraph_query.cc defines them. */
ID *DEG_get_original_id(ID *id) { return id && id->orig_id ? id->orig_id : id; }
const ID *DEG_get_original_id(const ID *id) { return id && id->orig_id ? id->orig_id : id; }
bool DEG_is_original_id(const ID *id)
{
  return !(id->tag & (ID_TAG_COPIED_ON_EVAL | ID_TAG_COPIED_ON_EVAL_FINAL_RESULT | ID_TAG_LOCALIZED));
}

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
/* Gives an operator a modal variant for adjusting it interactively in Blender's UI; its exec is unchanged. */
void WM_operator_type_modal_from_exec_for_object_edit_coords(wmOperatorType * /*ot*/) {}

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

}  // namespace blender
