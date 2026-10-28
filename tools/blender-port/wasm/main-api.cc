/* Blender's data outside Edit Mode, without a window manager: a Main holding Bylonder's objects and their data, one
 * Scene with one ViewLayer whose Bases hold the selection and the active object, and a window whose screen answers
 * context members as Blender's screen context does (screen_context.cc). Bylonder owns the data: before an operator the
 * editor writes the objects' transforms, parents, bases and data here, and afterwards reads back what the operator
 * tagged (DEG_id_tag_update keeps its tags on the ID). Operators run by their own exec (operator_exec, on main_C).
 * Other subsystems keep their IDs in the same Main (main_bmain) and their object data on its objects (object_data). */
#include "BKE_attribute.hh"
#include "BKE_collection.hh"
#include "BKE_node.hh"
#include "BKE_node_tree_update.hh"
#include "DNA_light_types.h"
#include "DNA_linestyle_types.h"
#include "DNA_material_types.h"
#include "DNA_texture_types.h"
#include "DNA_world_types.h"
#include "BKE_context.hh"
#include "BKE_wm_runtime.hh"
#include "DNA_collection_types.h"
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
#include "BLI_string.h"
#include "DEG_depsgraph_query.hh"
#include "DNA_layer_types.h"
#include "DNA_mesh_types.h"
#include "DNA_object_types.h"
#include "DNA_scene_types.h"
#include "DNA_screen_types.h"
#include "DNA_windowmanager_types.h"
#include "DNA_workspace_types.h"
#include "ED_screen.hh"
#include "MEM_guardedalloc.h"
#include "NOD_defaults.hh"
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
  wmWindowManager wm = {};
  wmWindow window = {};
  wmEvent eventstate = {};
  WorkSpaceInstanceHook workspace_hook = {};
  WorkSpace workspace = {};
  WorkSpaceLayout layout = {};
  bScreen screen = {};
  ExtractionHeader extraction = {};
};

static void collections_synced(BlenderMain *ctx);

EXPORT(main_new) BlenderMain *main_new()
{
  types_ensure();
  BlenderMain *ctx = MEM_new<BlenderMain>(__func__);
  /* As BKE_main_new makes it, without the working color space: the module has no color management. */
  ctx->bmain = MEM_new<Main>(__func__);
  STRNCPY(ctx->scene.id.name, "SCScene");
  STRNCPY(ctx->view_layer.name, "ViewLayer");
  ctx->view_layer.runtime = MEM_new<ViewLayerRuntime>(__func__);
  BLI_addtail(&ctx->scene.view_layers, &ctx->view_layer);
  ctx->scene.master_collection = BKE_collection_master_add(&ctx->scene);
  ctx->scene.toolsettings = &ctx->tool_settings;
  /* Auto keying is off until Bylonder sets its own (anim_scene_time_set). */
  ctx->tool_settings.autokey_mode = eAutokey_Mode(AUTOKEY_MODE_NORMAL & ~AUTOKEY_ON);
  ctx->screen.context = reinterpret_cast<void *>(ed_screen_context);
  ctx->layout.screen = &ctx->screen;
  ctx->workspace_hook = {&ctx->workspace, &ctx->layout};
  ctx->window.scene = &ctx->scene;
  ctx->window.workspace_hook = &ctx->workspace_hook;
  /* The window's event state, which buttons and operators read the held keys from. */
  ctx->window.runtime = MEM_new<bke::WindowRuntime>(__func__);
  ctx->window.runtime->eventstate = &ctx->eventstate;
  ctx->wm.runtime = MEM_new<bke::WindowManagerRuntime>(__func__);
  BLI_addtail(&ctx->wm.windows, &ctx->window);
  ctx->C = CTX_create();
  CTX_data_main_set(ctx->C, ctx->bmain);
  CTX_wm_manager_set(ctx->C, &ctx->wm);
  CTX_wm_window_set(ctx->C, &ctx->window);
  collections_synced(ctx);
  return ctx;
}

EXPORT(main_C) bContext *main_C(BlenderMain *ctx) { return ctx->C; }
EXPORT(main_scene) Scene *main_scene(BlenderMain *ctx) { return &ctx->scene; }
/* The Main other subsystems add their IDs to, as BKE_*_add(bmain, name) does. */
EXPORT(main_bmain) Main *main_bmain(BlenderMain *ctx) { return ctx->bmain; }
EXPORT(main_view_layer) ViewLayer *main_view_layer(BlenderMain *ctx) { return &ctx->view_layer; }

static Base *base_of(BlenderMain *ctx, Object *ob) { return BKE_view_layer_base_find(&ctx->view_layer, ob); }

/* port-override: the module's one scene is not in Main's scenes (scene.cc, which makes them, is not built), so
 * BKE_main_collection_sync does not reach its view layer: the collections' changes are synced to it here, after each
 * change, as BKE_main_collection_sync syncs a scene's. */
static void collections_synced(BlenderMain *ctx)
{
  BKE_view_layer_need_resync_tag(&ctx->view_layer);
  BKE_view_layer_synced_ensure(*ctx->bmain, &ctx->scene, &ctx->view_layer);
}
EXPORT(main_collections_sync) void main_collections_sync(BlenderMain *ctx) { collections_synced(ctx); }

/* An object of a type (ObjectType) with new data of its type, as BKE_object_add makes it, in the Scene Collection. */
EXPORT(main_object_add) Object *main_object_add(BlenderMain *ctx, int type, const char *name)
{
  Object *ob = BKE_object_add_only_object(ctx->bmain, ObjectType(type), name);
  ob->data = static_cast<ID *>(BKE_object_obdata_add_from_type(ctx->bmain, ObjectType(type), name));
  BKE_collection_object_add(ctx->bmain, ctx->scene.master_collection, ob);
  collections_synced(ctx);
  return ob;
}

/* An object's data (Mesh, Curve, Light, Camera...), or null for an empty. */
EXPORT(object_data) ID *object_data(Object *ob) { return ob->data; }

/* Removes an object and its data from its collections and Main; no other object may have it as parent. */
EXPORT(main_object_remove) void main_object_remove(BlenderMain *ctx, Object *ob)
{
  for (Collection &collection : ctx->bmain->collections) {
    BKE_collection_object_remove(ctx->bmain, &collection, ob, false);
  }
  BKE_collection_object_remove(ctx->bmain, ctx->scene.master_collection, ob, false);
  collections_synced(ctx);
  if (ob->data) {
    BKE_id_free(ctx->bmain, ob->data);
  }
  BKE_id_free(ctx->bmain, ob);
}

/* Collections. A collection's parent and objects are set whole, in order, as Bylonder holds them. */

/* A collection (in Main's collections), as a child of a parent (null: the Scene Collection). */
EXPORT(main_collection_add) Collection *main_collection_add(BlenderMain *ctx, Collection *parent, const char *name)
{
  Collection *collection = BKE_collection_add(ctx->bmain, parent ? parent : ctx->scene.master_collection, name);
  collections_synced(ctx);
  return collection;
}
EXPORT(main_collection_remove) void main_collection_remove(BlenderMain *ctx, Collection *collection)
{
  BKE_id_free(ctx->bmain, &collection->id);
  collections_synced(ctx);
}
/* The Scene Collection. */
EXPORT(main_collection_master) Collection *main_collection_master(BlenderMain *ctx) { return ctx->scene.master_collection; }

/* A collection's children: those given, in order. */
EXPORT(collection_children_set) void collection_children_set(BlenderMain *ctx, Collection *parent, Collection **children, int count)
{
  const Set<Collection *> wanted(Span(children, count));
  Vector<Collection *> stale;
  for (CollectionChild &child : parent->children) {
    if (!wanted.contains(child.collection)) {
      stale.append(child.collection);
    }
  }
  for (Collection *child : stale) {
    BKE_collection_child_remove(ctx->bmain, parent, child);
  }
  for (Collection *child : Span(children, count)) {
    if (!BKE_collection_has_collection(parent, child) || !BLI_findptr(&parent->children, child, offsetof(CollectionChild, collection))) {
      BKE_collection_child_add_no_sync(ctx->bmain, parent, child);
    }
  }
  /* Their order. */
  for (const int i : IndexRange(count)) {
    CollectionChild *link = static_cast<CollectionChild *>(BLI_findptr(&parent->children, children[i], offsetof(CollectionChild, collection)));
    BLI_remlink(&parent->children, link);
    BLI_addtail(&parent->children, link);
  }
  collections_synced(ctx);
}

/* A collection's objects: those given, in order. */
EXPORT(collection_objects_set) void collection_objects_set(BlenderMain *ctx, Collection *collection, Object **objects, int count)
{
  const Set<Object *> wanted(Span(objects, count));
  Vector<Object *> stale;
  for (CollectionObject &cob : collection->gobject) {
    if (!wanted.contains(cob.ob)) {
      stale.append(cob.ob);
    }
  }
  for (Object *ob : stale) {
    BKE_collection_object_remove(ctx->bmain, collection, ob, false);
  }
  for (Object *ob : Span(objects, count)) {
    BKE_collection_object_add(ctx->bmain, collection, ob);
  }
  for (const int i : IndexRange(count)) {
    CollectionObject *link = static_cast<CollectionObject *>(BLI_findptr(&collection->gobject, objects[i], offsetof(CollectionObject, ob)));
    BLI_remlink(&collection->gobject, link);
    BLI_addtail(&collection->gobject, link);
  }
  collections_synced(ctx);
}

/* What a collection holds, written to r_items when given: its children (`objects` false) or its objects. */
EXPORT(collection_items) int collection_items(Collection *collection, bool objects, void **r_items)
{
  int count = 0;
  if (objects) {
    for (CollectionObject &cob : collection->gobject) {
      if (r_items) {
        r_items[count] = cob.ob;
      }
      count++;
    }
  }
  else {
    for (CollectionChild &child : collection->children) {
      if (r_items) {
        r_items[count] = child.collection;
      }
      count++;
    }
  }
  return count;
}

/* Main's IDs of a type (ID_Type), written to r_ids when given. */
EXPORT(main_ids) int main_ids(BlenderMain *ctx, int type, ID **r_ids)
{
  int count = 0;
  for (ID &id : *which_libbase(ctx->bmain, short(type))) {
    if (r_ids) {
      r_ids[count] = &id;
    }
    count++;
  }
  return count;
}

/* An ID's name without its type code, and a rename as Blender renames IDs (unique in Main). */
EXPORT(id_name) const char *id_name(const ID *id) { return id->name + 2; }
EXPORT(id_rename) void id_rename(BlenderMain *ctx, ID *id, const char *name) { BKE_libblock_rename(*ctx->bmain, *id, name); }

/* A collection's LayerCollection in the view layer, the active one, and making one active. */
EXPORT(main_layer_collection) LayerCollection *main_layer_collection(BlenderMain *ctx, Collection *collection)
{
  return BKE_layer_collection_first_from_scene_collection(&ctx->view_layer, collection);
}
EXPORT(main_layer_collection_active) LayerCollection *main_layer_collection_active(BlenderMain *ctx)
{
  return BKE_layer_collection_get_active(&ctx->view_layer);
}
EXPORT(main_layer_collection_activate) void main_layer_collection_activate(BlenderMain *ctx, LayerCollection *lc)
{
  BKE_layer_collection_activate(&ctx->view_layer, lc);
}
EXPORT(layer_collection_collection) Collection *layer_collection_collection(LayerCollection *lc) { return lc->collection; }

/* An object's base flags (eBaseFlags) and whether it is the active one, or -1 when it has no base. */
EXPORT(main_base_get) int main_base_get(BlenderMain *ctx, Object *ob)
{
  BKE_view_layer_synced_ensure(*ctx->bmain, &ctx->scene, &ctx->view_layer);
  const Base *base = base_of(ctx, ob);
  return base ? base->flag | (ctx->view_layer.basact == base ? 1 << 30 : 0) : -1;
}
EXPORT(object_parent) Object *object_parent(Object *ob) { return ob->parent; }

/* An object's base: whether it is kept out of view (not `visible`), hidden, unselectable or selected, and whether it is
 * the active object, with its flags evaluated as the view layer's sync evaluates them. */
EXPORT(main_base_set)
void main_base_set(BlenderMain *ctx, Object *ob, bool visible, bool hidden, bool hide_select, bool select, bool active)
{
  Base *base = base_of(ctx, ob);
  if (!base) {
    return; /* Linked only to collections excluded from the view layer. */
  }
  /* Its collections' visibility is the view layer's sync's; an object they show can still be kept out of view. */
  if (!visible) {
    base->flag_from_collection = BASE_ENABLED_RENDER;
  }
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

/* port-override: the module has no shader nodes, so a new light gets no node tree (BKE_light_add); Bylonder's lights
 * draw without one. */
void nodes::node_tree_shader_default(const bContext * /*C*/, Main * /*bmain*/, ID * /*id*/) {}

/* As scene.cc defines it. */
void BKE_scene_object_base_flag_sync_from_base(Base *base) { base->object->base_flag = base->flag; }

/* As node.cc defines them; node.cc comes with Blender's node system, which the module does without. */
bNodeTree **bke::node_tree_ptr_from_id(ID *id)
{
  switch (GS(id->name)) {
    case ID_MA:
      return &reinterpret_cast<Material *>(id)->nodetree;
    case ID_LA:
      return &reinterpret_cast<Light *>(id)->nodetree;
    case ID_WO:
      return &reinterpret_cast<World *>(id)->nodetree;
    case ID_TE:
      return &reinterpret_cast<Tex *>(id)->nodetree;
    case ID_SCE:
      return &reinterpret_cast<Scene *>(id)->nodetree;
    case ID_LS:
      return &reinterpret_cast<FreestyleLineStyle *>(id)->nodetree;
    default:
      return nullptr;
  }
}
bNodeTree *bke::node_tree_from_id(ID *id)
{
  bNodeTree **nodetree = node_tree_ptr_from_id(id);
  return (nodetree != nullptr) ? *nodetree : nullptr;
}

/* port-override: Main holds no node trees (the module has no nodes), so no node tree uses an ID that changed. */
void bke::node_tree_update_all_users(Main * /*main*/, ID * /*id*/) {}

/* As wm_window.cc defines it for the one window, whose screen has no 3D View of the module's to sync. */
void WM_windows_scene_data_sync(const ListBaseT<wmWindow> * /*win_lb*/, Scene * /*scene*/) {}

/* port-override: Main holds no node trees (the module has no nodes), so after an ID's removal none has to update. */
void BKE_ntree_update(Main & /*bmain*/, std::optional<Span<bNodeTree *>> /*modified_trees*/, const NodeTreeUpdateExtraParams & /*params*/) {}

/* As area.cc defines it for the regions Bylonder's areas have, none of which overlap. */
bool ED_region_is_overlap(int /*spacetype*/, int /*regiontype*/) { return false; }

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
