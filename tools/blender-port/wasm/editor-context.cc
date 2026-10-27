/* Blender's mesh editors without a window manager: a scene with one object in Edit Mode, found the way Blender's
 * context finds it (the context store), and operators registered by their own MESH_OT_* functions and run by their
 * own exec. The window manager's and depsgraph's updates have nothing to update here, so they do nothing. */
#include "BLI_listbase.h"
#include "BLI_math_matrix.hh"
#include "CLG_log.h"
#include "BLF_api.hh"
#include "BKE_global.hh"
#include "BLI_string.h"

#include "BKE_context.hh"
#include "BKE_editmesh.hh"
#include "BKE_layer.hh"
#include "BKE_mesh_types.hh"
#include "BKE_object_types.hh"

#include "DEG_depsgraph.hh"

#include "DNA_layer_types.h"
#include "DNA_mesh_types.h"
#include "DNA_object_types.h"
#include "DNA_scene_types.h"

#include "BKE_report.hh"
#include "DNA_key_types.h"
#include "ED_mesh.hh"
#include "ED_object.hh"
#include "ED_screen.hh"
#include "ED_view3d.hh"
#include "BKE_scene.hh"
#include "ED_select_utils.hh"

#include "WM_api.hh"
#include "WM_types.hh"

#include "bmesh.hh"
#include "mesh_intern.hh"
#include "operator-properties.hh"
#include "extraction.hh"

using namespace blender;
using namespace blender::ed::mesh;

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
  Extraction extraction;
};

EXPORT(edit_context_new) EditContext *edit_context_new(BMesh *bm)
{
  EditContext *ctx = MEM_new<EditContext>(__func__);
  ctx->mesh.runtime = MEM_new<bke::MeshRuntime>(__func__);
  ctx->mesh.runtime->edit_mesh = std::make_shared<BMEditMesh>();
  ctx->mesh.runtime->edit_mesh->bm = bm;
  ctx->mesh.runtime->edit_mesh->selectmode = bm->selectmode;
  STRNCPY(ctx->mesh.id.name, "MEMesh");
  ctx->object.runtime = MEM_new<bke::ObjectRuntime>(__func__);
  ctx->object.type = OB_MESH;
  ctx->object.mode = OB_MODE_EDIT;
  ctx->object.data = &ctx->mesh.id;
  STRNCPY(ctx->object.id.name, "OBMesh");
  ctx->base.object = &ctx->object;
  ctx->base.flag = BASE_SELECTED | BASE_ENABLED_AND_VISIBLE_IN_DEFAULT_VIEWPORT;
  BLI_addtail(&ctx->view_layer.object_bases, &ctx->base);
  ctx->view_layer.basact = &ctx->base;
  BLI_addtail(&ctx->scene.view_layers, &ctx->view_layer);
  ctx->tool_settings.selectmode = bm->selectmode;
  ctx->scene.toolsettings = &ctx->tool_settings;

  ctx->C = CTX_create();
  CTX_data_scene_set(ctx->C, &ctx->scene);
  PointerRNA object_ptr = {&ctx->object.id, nullptr, &ctx->object};
  CTX_store_add(ctx->stores, "edit_object", &object_ptr);
  CTX_store_add(ctx->stores, "active_object", &object_ptr);
  bContextStore *store = CTX_store_add(ctx->stores, "object", &object_ptr);
  CTX_store_set(ctx->C, store);
  return ctx;
}

EXPORT(edit_context_free) void edit_context_free(EditContext *ctx)
{
  CTX_free(ctx->C);
  BM_mesh_free(ctx->mesh.runtime->edit_mesh->bm);
  ctx->mesh.runtime->edit_mesh.reset();
  MEM_delete(ctx->mesh.runtime);
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

static Vector<OperatorDefinition> &operators()
{
  static Vector<OperatorDefinition> table = {
#define OPERATOR(define) {#define, define},
#include "operators.inc"
#undef OPERATOR
  };
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

/* Polls and runs an operator's exec: its wmOperatorStatus flags, or 0 when it does not poll or has no exec. */
EXPORT(operator_exec) int operator_exec(EditContext *ctx, wmOperator *op)
{
  if (!op->type->exec || (op->type->poll && !op->type->poll(ctx->C))) {
    return 0;
  }
  return int(op->type->exec(ctx->C, op));
}

/* What the operators reach of Blender beyond the module. */

namespace blender {

/* port-override: one base in the view layer, so the bases in a mode are the active one when it is in that mode. */
void BKE_view_layer_bases_in_mode_iterator_begin(BLI_Iterator *iter, void *data_in)
{
  ObjectsInModeIteratorData *data = static_cast<ObjectsInModeIteratorData *>(data_in);
  Base *base = data->base_active;
  iter->data = data_in;
  iter->current = base;
  iter->valid = base && (base->object->mode & data->object_mode);
}
void BKE_view_layer_bases_in_mode_iterator_next(BLI_Iterator *iter) { iter->valid = false; }
void BKE_view_layer_bases_in_mode_iterator_end(BLI_Iterator * /*iter*/) {}
ViewLayer *BKE_view_layer_default_view(const Scene *scene) { return static_cast<ViewLayer *>(scene->view_layers.first); }
ViewLayer *BKE_view_layer_find(const Scene *scene, const char * /*layer_name*/) { return BKE_view_layer_default_view(scene); }
Base *BKE_view_layer_base_find(ViewLayer *view_layer, Object *ob)
{
  return static_cast<Base *>(BLI_findptr(&view_layer->object_bases, ob, offsetof(Base, object)));
}
void BKE_view_layer_synced_ensure(const Scene * /*scene*/, ViewLayer * /*view_layer*/) {}
void _BKE_view_layer_synced_ensure_or_assert(const Main * /*bmain*/, const Scene * /*scene*/, ViewLayer * /*view_layer*/) {}

/* As object.cc defines them; object.cc comes with the rest of Blender's object handling. */
const float4x4 &Object::object_to_world() const { return this->runtime->object_to_world; }
const float4x4 &Object::world_to_object() const { return this->runtime->world_to_object; }

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
/* port-override: the 3D View the operator needs is the editor's own, whose picking runs in JS. */
bool ED_operator_editmesh_region_view3d(bContext *C) { return ED_operator_editmesh(C); }

/* port-override: the module has no depsgraph. The editor refuses Edit Mode on objects with modifiers, so what an
 * operator would read as evaluated is the original and nothing needs evaluating; the depsgraph is a token. */
Depsgraph *BKE_scene_ensure_depsgraph(Main * /*bmain*/, Scene * /*scene*/, ViewLayer * /*view_layer*/)
{
  static char token;
  return reinterpret_cast<Depsgraph *>(&token);
}
void DEG_make_active(Depsgraph * /*depsgraph*/) {}
void BKE_scene_graph_evaluated_ensure(Depsgraph * /*depsgraph*/, Main * /*bmain*/) {}

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

/* Blender's globals, defined as blender.cc, blf.cc and rna_access.cc define them: their types' member defaults are
 * Blender's defaults. */
Global G;
UserDef U;
int blf_mono_font = -1;
extern const PointerRNA PointerRNA_NULL = {};

/* Marks the properties after it as advanced in Blender's UI. */
void WM_operatortype_props_advanced_begin(wmOperatorType * /*ot*/) {}
/* Gives an operator a modal variant for adjusting it interactively in Blender's UI; its exec is unchanged. */
void WM_operator_type_modal_from_exec_for_object_edit_coords(wmOperatorType * /*ot*/) {}

/* No window, depsgraph or view to update. */
void ED_workspace_status_text(bContext * /*C*/, const char * /*str*/) {}
void DEG_id_tag_update(ID * /*id*/, unsigned int /*flags*/) {}
void DEG_id_tag_update_ex(Main * /*bmain*/, ID * /*id*/, unsigned int /*flags*/) {}
void WM_main_add_notifier(uint /*type*/, void * /*reference*/) {}
void WM_event_add_notifier(const bContext * /*C*/, uint /*type*/, void * /*reference*/) {}

}  // namespace blender
