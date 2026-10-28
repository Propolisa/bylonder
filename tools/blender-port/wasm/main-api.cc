/* Blender's data outside Edit Mode, without a window manager: a Main holding Bylonder's objects and their data, one
 * Scene with one ViewLayer whose Bases hold the selection and the active object, and a window whose screen answers
 * context members as Blender's screen context does (screen_context.cc). Bylonder owns the data: before an operator the
 * editor writes the objects' transforms, parents, bases and data here, and afterwards reads back what the operator
 * tagged (DEG_id_tag_update keeps its tags on the ID). Operators run by their own exec (operator_exec, on main_C).
 * Other subsystems keep their IDs in the same Main (main_bmain) and their object data on its objects (object_data). */
#include "BKE_attribute.hh"
#include "BKE_context.hh"
#include "BKE_global.hh"
#include "BKE_layer.hh"
#include "BKE_lib_id.hh"
#include "BKE_library.hh"
#include "BKE_main.hh"
#include "BKE_mesh.h"
#include "BKE_mesh.hh"
#include "BKE_object.hh"
#include "BKE_object_types.hh"
#include "BKE_workspace.hh"
#include "BLI_listbase.h"
#include "BLI_math_matrix.h"
#include "BLI_set.hh"
#include "DEG_depsgraph_query.hh"
#include "DNA_layer_types.h"
#include "DNA_mesh_types.h"
#include "DNA_object_types.h"
#include "DNA_scene_types.h"
#include "DNA_screen_types.h"
#include "DNA_windowmanager_types.h"
#include "DNA_workspace_types.h"
#include "MEM_guardedalloc.h"
#include "WM_api.hh"

#include "extraction.hh"

using namespace blender;

#define EXPORT(name) extern "C" __attribute__((export_name(#name)))

void types_ensure();
namespace blender {
int ed_screen_context(const bContext *C, const char *member, bContextDataResult *result);
}

struct BlenderMain {
  bContext *C;
  Main *bmain;
  Scene scene = {};
  ToolSettings tool_settings = {};
  ViewLayer view_layer = {};
  wmWindow window = {};
  WorkSpaceInstanceHook workspace_hook = {};
  WorkSpace workspace = {};
  WorkSpaceLayout layout = {};
  bScreen screen = {};
  ExtractionHeader extraction = {};
};

EXPORT(main_new) BlenderMain *main_new()
{
  types_ensure();
  BlenderMain *ctx = MEM_new<BlenderMain>(__func__);
  /* As BKE_main_new makes it, without the working color space: the module has no color management. */
  ctx->bmain = MEM_new<Main>(__func__);
  /* The Main Blender's code finds through G_MAIN (the built-in font, BKE_vfont_builtin_ensure), as loading a file sets it. */
  G_MAIN = ctx->bmain;
  ctx->view_layer.runtime = MEM_new<ViewLayerRuntime>(__func__);
  BLI_addtail(&ctx->scene.view_layers, &ctx->view_layer);
  ctx->scene.toolsettings = &ctx->tool_settings;
  /* port-override: the module has no animation data yet, so Blender's auto keying stays off. */
  ctx->tool_settings.autokey_mode = eAutokey_Mode(AUTOKEY_MODE_NORMAL & ~AUTOKEY_ON);
  ctx->screen.context = reinterpret_cast<void *>(ed_screen_context);
  ctx->layout.screen = &ctx->screen;
  ctx->workspace_hook = {&ctx->workspace, &ctx->layout};
  ctx->window.scene = &ctx->scene;
  ctx->window.workspace_hook = &ctx->workspace_hook;
  ctx->C = CTX_create();
  CTX_data_main_set(ctx->C, ctx->bmain);
  CTX_wm_window_set(ctx->C, &ctx->window);
  return ctx;
}

EXPORT(main_C) bContext *main_C(BlenderMain *ctx) { return ctx->C; }
/* The Main other subsystems add their IDs to, as BKE_*_add(bmain, name) does. */
EXPORT(main_bmain) Main *main_bmain(BlenderMain *ctx) { return ctx->bmain; }

static Base *base_of(BlenderMain *ctx, Object *ob) { return BKE_view_layer_base_find(&ctx->view_layer, ob); }

/* The bases changed, so the view layer's map from objects to them is made again when next asked. */
static void bases_changed(BlenderMain *ctx) { MEM_SAFE_DELETE(ctx->view_layer.runtime->object_bases_hash); }

/* An object of a type (ObjectType) with new data of its type, as BKE_object_add makes it, in the view layer. */
EXPORT(main_object_add) Object *main_object_add(BlenderMain *ctx, int type, const char *name)
{
  Object *ob = BKE_object_add_only_object(ctx->bmain, ObjectType(type), name);
  ob->data = static_cast<ID *>(BKE_object_obdata_add_from_type(ctx->bmain, ObjectType(type), name));
  Base *base = MEM_new<Base>(__func__);
  base->object = ob;
  base->local_view_bits = ~0;
  BLI_addtail(&ctx->view_layer.object_bases, base);
  bases_changed(ctx);
  return ob;
}

/* An object's data (Mesh, Curve, Light, Camera...), or null for an empty. */
EXPORT(object_data) ID *object_data(Object *ob) { return ob->data; }

/* Removes an object and its data; no other object may have it as parent. */
EXPORT(main_object_remove) void main_object_remove(BlenderMain *ctx, Object *ob)
{
  Base *base = base_of(ctx, ob);
  if (ctx->view_layer.basact == base) {
    ctx->view_layer.basact = nullptr;
  }
  BLI_freelinkN(&ctx->view_layer.object_bases, base);
  bases_changed(ctx);
  if (ob->data) {
    BKE_id_free(ctx->bmain, ob->data);
  }
  BKE_id_free(ctx->bmain, ob);
}

/* An object's base: its collection's visibility, whether it is hidden, unselectable or selected, and whether it is
 * the active object, with its flags evaluated as the view layer's sync evaluates them. */
EXPORT(main_base_set)
void main_base_set(BlenderMain *ctx, Object *ob, bool visible, bool hidden, bool hide_select, bool select, bool active)
{
  Base *base = base_of(ctx, ob);
  base->flag_from_collection = visible ? BASE_ENABLED_VIEWPORT | BASE_ENABLED_AND_MAYBE_VISIBLE_IN_VIEWPORT |
                                             BASE_ENABLED_AND_VISIBLE_IN_DEFAULT_VIEWPORT | BASE_SELECTABLE | BASE_ENABLED_RENDER :
                                         BASE_ENABLED_RENDER;
  SET_FLAG_FROM_TEST(base->flag, hidden, BASE_HIDDEN);
  SET_FLAG_FROM_TEST(base->flag, select, BASE_SELECTED);
  SET_FLAG_FROM_TEST(ob->visibility_flag, hide_select, OB_HIDE_SELECT);
  BKE_base_eval_flags(base);
  ob->base_flag = base->flag;
  if (active) {
    ctx->view_layer.basact = base;
  }
  else if (ctx->view_layer.basact == base) {
    ctx->view_layer.basact = nullptr;
  }
}

/* An object's parent (null for none), parented to the object as a whole. */
EXPORT(object_parent_set) void object_parent_set(Object *ob, Object *parent)
{
  ob->parent = parent;
  ob->partype = PAROBJECT;
}

/* An object's mode (eObjectMode). */
EXPORT(object_mode_set) void object_mode_set(Object *ob, int mode) { ob->mode = eObjectMode(mode); }

/* port-override: Bylonder's objects have no parent inverse, so it folds into the object's own transform, keeping its
 * world matrix (evaluated). */
EXPORT(object_parent_inverse_fold) void object_parent_inverse_fold(Object *ob)
{
  unit_m4(ob->parentinv);
  BKE_object_apply_mat4(ob, ob->object_to_world().ptr(), true, true);
}

/* Where an object's transform is: Blender's DNA, which the editor reads and writes in place. */
struct ObjectFields {
  float *location, *rotation_euler, *rotation_quaternion, *scale;
  short *rotation_mode;
  float *matrix_parent_inverse, *matrix_world;
  unsigned int *recalc, *data_recalc;
};

EXPORT(object_fields) const ObjectFields *object_fields(Object *ob)
{
  static ObjectFields fields;
  fields = {ob->loc, ob->rot, ob->quat, ob->scale, &ob->rotmode, &ob->parentinv[0][0], ob->runtime->object_to_world.base_ptr(),
            &ob->id.recalc, ob->data ? &ob->data->recalc : nullptr};
  return &fields;
}

/* The scene's 3D cursor location and its pivot point (V3D_AROUND_*), which operators read. */
EXPORT(main_cursor) float *main_cursor(BlenderMain *ctx) { return ctx->scene.cursor.location; }
EXPORT(main_pivot_point_set) void main_pivot_point_set(BlenderMain *ctx, int pivot_point)
{
  ctx->tool_settings.transform_pivot_point = char(pivot_point);
}

static void where_is_calc(Depsgraph *depsgraph, Scene *scene, Object *ob, Set<Object *> &done)
{
  if (!done.add(ob)) {
    return;
  }
  if (ob->parent) {
    where_is_calc(depsgraph, scene, ob->parent, done);
  }
  BKE_object_where_is_calc(depsgraph, scene, ob);
}

/* What the depsgraph does once the editor has written the objects or an operator has changed them: each object's
 * world matrix, parents first, and the tags cleared. */
EXPORT(main_evaluate) void main_evaluate(BlenderMain *ctx)
{
  Depsgraph *depsgraph = CTX_data_ensure_evaluated_depsgraph(ctx->C);
  Set<Object *> done;
  for (Object &ob : ctx->bmain->objects) {
    where_is_calc(depsgraph, &ctx->scene, &ob, done);
    ob.id.recalc = 0;
    if (ob.data) {
      ob.data->recalc = 0;
    }
  }
}

/* A mesh object's Mesh replaced by one of the arrays bm_from_arrays takes; attributes are added after. */
EXPORT(object_mesh_set)
void object_mesh_set(Object *ob, int verts_num, const float3 *positions, int edges_num, const int2 *edges, int faces_num,
                     const int *face_offsets, const int *corner_verts, const int *corner_edges)
{
  const int corners_num = face_offsets[faces_num];
  Mesh *mesh = BKE_mesh_new_nomain(verts_num, edges_num, faces_num, corners_num);
  mesh->vert_positions_for_write().copy_from({positions, verts_num});
  mesh->edges_for_write().copy_from({edges, edges_num});
  mesh->face_offsets_for_write().copy_from({face_offsets, faces_num + 1});
  mesh->corner_verts_for_write().copy_from({corner_verts, corners_num});
  mesh->corner_edges_for_write().copy_from({corner_edges, corners_num});
  BKE_mesh_nomain_to_mesh(mesh, id_cast<Mesh *>(ob->data), ob);
}

/* Adds an attribute of a domain (AttrDomain) and type (AttrType) to a mesh object's Mesh, from one value per element. */
EXPORT(object_mesh_attribute_add) bool object_mesh_attribute_add(Object *ob, const char *name, int domain, int type, const void *data)
{
  bke::MutableAttributeAccessor attributes = id_cast<Mesh *>(ob->data)->attributes_for_write();
  const CPPType &cpp_type = bke::attribute_type_to_cpp_type(bke::AttrType(type));
  const GSpan values(cpp_type, data, attributes.domain_size(bke::AttrDomain(domain)));
  return attributes.add(name, bke::AttrDomain(domain), bke::AttrType(type), bke::AttributeInitVArray(GVArray::from_span(values)));
}

/* A mesh object's Mesh, read through the header until the next call. */
EXPORT(object_mesh_extract) const ExtractionHeader *object_mesh_extract(BlenderMain *ctx, Object *ob)
{
  mesh_extraction(*id_cast<Mesh *>(ob->data), ctx->extraction);
  return &ctx->extraction;
}

/* An attribute's values in a mesh object's Mesh, or null; valid until the Mesh changes. */
EXPORT(object_mesh_attribute) const void *object_mesh_attribute(Object *ob, const char *name)
{
  const bke::GAttributeReader reader = id_cast<Mesh *>(ob->data)->attributes().lookup(name);
  return reader && reader.varray.is_span() ? reader.varray.get_internal_span().data() : nullptr;
}

/* What the operators reach of Blender beyond the module. */

namespace blender {

/* As wm_window.cc defines them, for the one window. */
Scene *WM_window_get_active_scene(const wmWindow *win) { return win->scene; }
ViewLayer *WM_window_get_active_view_layer(const wmWindow *win)
{
  Scene *scene = WM_window_get_active_scene(win);
  if (scene == nullptr) {
    return nullptr;
  }
  ViewLayer *view_layer = BKE_view_layer_find(scene, win->view_layer_name);
  return view_layer ? view_layer : BKE_view_layer_default_view(scene);
}
WorkSpace *WM_window_get_active_workspace(const wmWindow *win) { return BKE_workspace_active_get(win->workspace_hook); }
bScreen *WM_window_get_active_screen(const wmWindow *win) { return BKE_workspace_active_screen_get(win->workspace_hook); }

/* As sound.cc defines it without audio (WITH_AUDASPACE), which the module has none of. */
void BKE_sound_refresh_callback_bmain(Main * /*bmain*/) {}

/* As screen_ops.cc defines it. */
bool ED_operator_objectmode(bContext *C)
{
  Scene *scene = CTX_data_scene(C);
  Object *obact = CTX_data_active_object(C);
  if (scene == nullptr || !ID_IS_EDITABLE(scene)) {
    return false;
  }
  if (CTX_data_edit_object(C)) {
    return false;
  }
  if (obact && (obact->mode != OB_MODE_OBJECT)) {
    return false;
  }
  return true;
}

}  // namespace blender
