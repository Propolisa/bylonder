/* Blender's mesh editors without a window manager: a scene with one object in Edit Mode, found the way Blender's
 * context finds it (the context store), and operators registered by their own MESH_OT_* functions and run by their
 * own exec. The window manager's and depsgraph's updates have nothing to update here, so they do nothing. */
#include "BLI_listbase.h"
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

#include "ED_screen.hh"

#include "WM_api.hh"
#include "WM_types.hh"

#include "bmesh.hh"
#include "mesh_intern.hh"
#include "operator-properties.hh"

using namespace blender;
using namespace blender::ed::mesh;

#define EXPORT(name) extern "C" __attribute__((export_name(#name)))

/* A scene holding one mesh object in Edit Mode, whose edit mesh is a BMesh made by bm_from_arrays. */
struct EditContext {
  bContext *C;
  Vector<std::unique_ptr<bContextStore>> stores;
  Scene scene = {};
  ToolSettings tool_settings = {};
  ViewLayer view_layer = {};
  Base base = {};
  Object object = {};
  Mesh mesh = {};
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
  ctx->mesh.runtime->edit_mesh.reset();
  MEM_delete(ctx->mesh.runtime);
  MEM_delete(ctx->object.runtime);
  MEM_delete(ctx);
}

/* The BMesh an operator leaves, which may be a new one (as Undo or a cancelled operator restore). */
EXPORT(edit_context_bmesh) BMesh *edit_context_bmesh(EditContext *ctx) { return ctx->mesh.runtime->edit_mesh->bm; }
EXPORT(edit_context_selectmode_set) void edit_context_selectmode_set(EditContext *ctx, int selectmode)
{
  ctx->tool_settings.selectmode = selectmode;
  ctx->mesh.runtime->edit_mesh->selectmode = selectmode;
  ctx->mesh.runtime->edit_mesh->bm->selectmode = selectmode;
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
  return op;
}

EXPORT(operator_free) void operator_free(wmOperator *op)
{
  operator_values_free(op->ptr->data);
  MEM_delete(op->ptr);
  MEM_delete(op);
}

/* Sets a property: numbers (len of them) or an enum item's identifier. */
EXPORT(operator_set) bool operator_set(wmOperator *op, const char *name, const double *numbers, int len, const char *enum_identifier)
{
  return operator_property_set(op->ptr, name, numbers, len, enum_identifier);
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

/* port-override: Blender's poll (screen_ops.cc), which comes with Blender's screens. */
bool ED_operator_editmesh(bContext *C)
{
  Object *obedit = CTX_data_edit_object(C);
  return obedit && obedit->type == OB_MESH && BKE_editmesh_from_object(obedit);
}
bool ED_operator_editable_mesh(bContext *C) { return ED_operator_editmesh(C); }

/* Blender's globals, defined as blender.cc, blf.cc and rna_access.cc define them: their types' member defaults are
 * Blender's defaults. */
Global G;
UserDef U;
int blf_mono_font = -1;
extern const PointerRNA PointerRNA_NULL = {};

/* Marks the properties after it as advanced in Blender's UI. */
void WM_operatortype_props_advanced_begin(wmOperatorType * /*ot*/) {}

/* No window, depsgraph or view to update. */
void DEG_id_tag_update(ID * /*id*/, unsigned int /*flags*/) {}
void DEG_id_tag_update_ex(Main * /*bmain*/, ID * /*id*/, unsigned int /*flags*/) {}
void WM_main_add_notifier(uint /*type*/, void * /*reference*/) {}
void WM_event_add_notifier(const bContext * /*C*/, uint /*type*/, void * /*reference*/) {}

}  // namespace blender
