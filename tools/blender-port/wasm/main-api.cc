/* Blender's data outside Edit Mode: a Main holding Bylonder's objects and their data, one Scene with one ViewLayer
 * whose Bases hold the selection and the active object, and Main's window manager with one window whose screen
 * answers context members as Blender's screen context does (screen_context.cc) and runs its events (wm-api.cc). Main
 * owns the data (docs/model.md); Blender's depsgraph evaluates it, and Babylon draws what the evaluation updated
 * (src/blenkernel/main-view.js). Operators run by their own exec (operator_exec, on main_C).
 * Other subsystems keep their IDs in the same Main (main_bmain) and their object data on its objects (object_data). */
#include "BKE_armature.hh"
#include "BKE_attribute.hh"
#include "BKE_collection.hh"
#include "BKE_duplilist.hh"
#include "BKE_curve_to_mesh.hh"
#include "BKE_curves.hh"
#include "BKE_geometry_set.hh"
#include "BKE_idprop.hh"
#include "BKE_idtype.hh"
#include "AS_asset_library.hh"
#include "BKE_report.hh"
#include "BKE_sound.hh"
#include "NOD_socket.hh"
#include "BKE_blendfile.hh"
#include "RE_pipeline.h"
#include "BLO_readfile.hh"
#include "BKE_material.hh"
#include "BKE_world.h"
#include "BKE_node.hh"
#include "BKE_node_runtime.hh"
#include "BKE_main_invariants.hh"
#include "BKE_node_tree_update.hh"
#include "DNA_light_types.h"
#include "DNA_material_types.h"
#include "DNA_world_types.h"
#include "BKE_context.hh"
#include "BKE_global.hh"
#include "BKE_wm_runtime.hh"
#include "DNA_collection_types.h"
#include "BKE_layer.hh"
#include "BKE_lib_id.hh"
#include "BKE_library.hh"
#include "BKE_main.hh"
#include "BKE_modifier.hh"
#include "BKE_mesh.h"
#include "BKE_mesh.hh"
#include "BKE_mesh_runtime.hh"
#include "BKE_object.hh"
#include "BKE_object_types.hh"
#include "BKE_particle.h"
#include "DNA_particle_types.h"
#include "BKE_scene.hh"
#include "BKE_workspace.hh"
#include "BLI_filereader.h"
#include "BLI_iterator.h"
#include "BLI_listbase.h"
#include "BLI_math_matrix.h"
#include "BLI_math_rotation.h"
#include "BLI_generic_array.hh"
#include "BLI_map.hh"
#include "BLI_set.hh"
#include "BLI_string.h"
#include "BLI_string_utf8.h"
#include "DEG_depsgraph.hh"
#include "DEG_depsgraph_build.hh"
#include "DEG_depsgraph_query.hh"
#include "DNA_layer_types.h"
#include "DNA_mesh_types.h"
#include "DNA_object_types.h"
#include "DNA_scene_types.h"
#include "DNA_screen_types.h"
#include "DNA_windowmanager_types.h"
#include "DNA_userdef_types.h"
#include "DNA_workspace_types.h"
#include "ED_object.hh"
#include "ED_screen.hh"
#include "DNA_genfile.h"
#include "DNA_sequence_types.h"
#include "DNA_view3d_enums.h"
#include "GPU_material.hh"
#include "IMB_colormanagement.hh"
#include "MEM_guardedalloc.h"
#include "DNA_view3d_types.h"
#include "area.hh"
#include "NOD_defaults.hh"
#include "SEQ_iterator.hh"
#include "SEQ_sequencer.hh"
#include "WM_api.hh"

#include "extraction.hh"

#include <algorithm>
#include <cfloat>
#include <string>

using namespace blender;

#define EXPORT(name) extern "C" __attribute__((export_name(#name)))

void types_ensure();
namespace blender {
void wm_init(bContext *C);
int ed_screen_context(const bContext *C, const char *member, bContextDataResult *result);
}

struct BlenderMain {
  bContext *C;
  Main *bmain;
  /* Main's one scene, as BKE_scene_add makes it, and its view layer. */
  Scene *scene;
  ViewLayer *view_layer;
  wmWindowManager *wm;
  wmWindow window = {};
  wmEvent eventstate = {};
  WorkSpaceInstanceHook workspace_hook = {};
  WorkSpace workspace = {};
  WorkSpaceLayout layout = {};
  bScreen screen = {};
  ExtractionHeader extraction = {};
  /* The 3D View Object Mode's operators act in once the editor gives its view (main_view_set). */
  BylonderArea view_area;
  View3D v3d = {};
  ARegion region = {};
  RegionView3D rv3d = {};
};

static void collections_synced(BlenderMain *ctx);
static void scene_updated(const DEGEditorUpdateContext *update_ctx, bool updated);

EXPORT(main_new) BlenderMain *main_new()
{
  types_ensure();
  BlenderMain *ctx = MEM_new<BlenderMain>(__func__);
  /* As BKE_main_new makes it, without the working color space: the module has no color management. */
  ctx->bmain = MEM_new<Main>(__func__);
  /* The Main Blender's code finds through G_MAIN (the built-in font, BKE_vfont_builtin_ensure), as loading a file sets it. */
  G_MAIN = ctx->bmain;
  ctx->scene = BKE_scene_add(ctx->bmain, "Scene");
  ctx->view_layer = BKE_view_layer_default_view(ctx->scene);
  /* Auto keying is off until the scene sync sets Bylonder's. */
  ctx->scene->toolsettings->autokey_mode = eAutokey_Mode(AUTOKEY_MODE_NORMAL & ~AUTOKEY_ON);
  ctx->screen.context = reinterpret_cast<void *>(ed_screen_context);
  ctx->layout.screen = &ctx->screen;
  /* As BKE_workspace_add makes it: an ID (RNA's WorkSpace, its tools for the scripts) whose status transforms clear when
   * they end. */
  STRNCPY(ctx->workspace.id.name, "WSLayout");
  ctx->workspace.runtime = MEM_new<bke::WorkSpaceRuntime>(__func__);
  ctx->workspace_hook = {&ctx->workspace, &ctx->layout};
  ctx->window.scene = ctx->scene;
  ctx->window.workspace_hook = &ctx->workspace_hook;
  /* The window's event state, which buttons and operators read the held keys from. */
  ctx->window.runtime = MEM_new<bke::WindowRuntime>(__func__);
  ctx->window.runtime->eventstate = &ctx->eventstate;
  /* As wm_add_default makes it: Main's window manager, where Blender's code finds it (G_MAIN->wm), with its window. */
  ctx->wm = static_cast<wmWindowManager *>(BKE_libblock_alloc(ctx->bmain, ID_WM, "WinMan", 0));
  ctx->wm->runtime = MEM_new<bke::WindowManagerRuntime>(__func__);
  BLI_addtail(&ctx->wm->windows, &ctx->window);
  ctx->C = CTX_create();
  CTX_data_main_set(ctx->C, ctx->bmain);
  CTX_wm_manager_set(ctx->C, ctx->wm);
  CTX_wm_window_set(ctx->C, &ctx->window);
  wm_init(ctx->C);
  DEG_editors_set_update_cb(nullptr, scene_updated);
  collections_synced(ctx);
  return ctx;
}

EXPORT(main_C) bContext *main_C(BlenderMain *ctx) { return ctx->C; }

void view3d_region_set(ScrArea &area, View3D &v3d, ARegion &region, RegionView3D &rv3d, const float *viewmat, const float *winmat, int winx,
                       int winy, bool is_persp);
/* The 3D View the editor shows, as edit_context_view_set gives Edit Mode's: Object Mode's operators (transforms, view
 * operators) then act in its window region. */
EXPORT(main_view_set)
void main_view_set(BlenderMain *ctx, const float *viewmat, const float *winmat, int winx, int winy, bool is_persp)
{
  ScrArea &area = ctx->view_area.area;
  if (BLI_listbase_is_empty(&area.spacedata)) {
    BLI_addtail(&ctx->screen.areabase, &area);
  }
  view3d_region_set(area, ctx->v3d, ctx->region, ctx->rv3d, viewmat, winmat, winx, winy, is_persp);
  CTX_wm_window_set(ctx->C, &ctx->window);
  CTX_wm_area_set(ctx->C, &area);
  CTX_wm_region_set(ctx->C, &ctx->region);
}
/* What the last operator showed in the view's header (ED_area_status_text), or ''. */
EXPORT(main_status) const char *main_status(BlenderMain *ctx) { return ctx->view_area.status.c_str(); }
EXPORT(main_scene) Scene *main_scene(BlenderMain *ctx) { return ctx->scene; }
/* The Main other subsystems add their IDs to, as BKE_*_add(bmain, name) does. */
EXPORT(main_bmain) Main *main_bmain(BlenderMain *ctx) { return ctx->bmain; }
EXPORT(main_view_layer) ViewLayer *main_view_layer(BlenderMain *ctx) { return ctx->view_layer; }
/* The scene's active camera (an object, or null). */
EXPORT(main_scene_camera_set) void main_scene_camera_set(BlenderMain *ctx, Object *camera)
{
  ctx->scene->camera = camera;
  DEG_relations_tag_update(ctx->bmain);
}

static Base *base_of(BlenderMain *ctx, Object *ob) { return BKE_view_layer_base_find(ctx->view_layer, ob); }

/* The collections' changes synced to the view layer after each change, as BKE_main_collection_sync syncs a scene's. */
static void collections_synced(BlenderMain *ctx)
{
  BKE_view_layer_need_resync_tag(ctx->view_layer);
  BKE_view_layer_synced_ensure(*ctx->bmain, ctx->scene, ctx->view_layer);
  DEG_id_tag_update(&ctx->scene->id, ID_RECALC_BASE_FLAGS | ID_RECALC_SYNC_TO_EVAL);
  DEG_relations_tag_update(ctx->bmain);
}
EXPORT(main_collections_sync) void main_collections_sync(BlenderMain *ctx) { collections_synced(ctx); }

/* An object of a type (ObjectType) with new data of its type, as BKE_object_add makes it, in the active collection. */
EXPORT(main_object_add) Object *main_object_add(BlenderMain *ctx, int type, const char *name)
{
  Object *ob = BKE_object_add_only_object(ctx->bmain, ObjectType(type), name);
  ob->data = static_cast<ID *>(BKE_object_obdata_add_from_type(ctx->bmain, ObjectType(type), name));
  BKE_view_layer_synced_ensure(*ctx->bmain, ctx->scene, ctx->view_layer);
  BKE_collection_object_add(ctx->bmain, BKE_view_layer_active_collection_get(ctx->view_layer)->collection, ob);
  collections_synced(ctx);
  return ob;
}

/* An object's data (Mesh, Curve, Light, Camera...), or null for an empty. */
EXPORT(object_data) ID *object_data(Object *ob) { return ob->data; }

/* Changes an object's rotation mode (eRotationModes) keeping its rotation, as Blender's Rotation Mode does
 * (BKE_rotMode_change_values). */
EXPORT(object_rotation_mode_set) void object_rotation_mode_set(Object *ob, int mode)
{
  float mat[3][3];
  BKE_object_rot_to_mat3(ob, mat, false);
  normalize_m3(mat);
  if (mode > 0) {
    mat3_normalized_to_compatible_eulO(ob->rot, ob->rot, mode, mat);
  }
  else {
    mat3_normalized_to_quat(ob->quat, mat);
  }
  ob->rotmode = mode;
  DEG_id_tag_update(&ob->id, ID_RECALC_TRANSFORM);
}

/* Removes an object and its data from its collections and Main; no other object may have it as parent. */
EXPORT(main_object_remove) void main_object_remove(BlenderMain *ctx, Object *ob)
{
  for (Collection &collection : ctx->bmain->collections) {
    BKE_collection_object_remove(ctx->bmain, &collection, ob, false);
  }
  BKE_collection_object_remove(ctx->bmain, ctx->scene->master_collection, ob, false);
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
  Collection *collection = BKE_collection_add(ctx->bmain, parent ? parent : ctx->scene->master_collection, name);
  collections_synced(ctx);
  return collection;
}
/* Blender's Delete: its objects and children go to its parents (BKE_collection_delete, not its hierarchy). */
EXPORT(main_collection_remove) void main_collection_remove(BlenderMain *ctx, Collection *collection)
{
  BKE_collection_delete(ctx->bmain, collection, false);
  collections_synced(ctx);
}
/* The Scene Collection. */
EXPORT(main_collection_master) Collection *main_collection_master(BlenderMain *ctx) { return ctx->scene->master_collection; }

/* Objects Blender's code deleted leave the Scene Collection, as remapping unlinks a deleted object from the scenes in
 * Main (BKE_collections_object_remove_nulls), which the module's scene is not one of. Its object cache is made again. */
EXPORT(main_collection_master_clean) void main_collection_master_clean(BlenderMain *ctx)
{
  Collection *master = ctx->scene->master_collection;
  Set<const Object *> alive;
  for (const Object &ob : ctx->bmain->objects) {
    alive.add(&ob);
  }
  bool changed = false;
  for (CollectionObject *cob = static_cast<CollectionObject *>(master->gobject.first), *next; cob; cob = next) {
    next = cob->next;
    if (!alive.contains(cob->ob)) {
      BLI_freelinkN(&master->gobject, cob);
      changed = true;
    }
  }
  if (changed) {
    MEM_delete(master->runtime->gobject_hash);
    master->runtime->gobject_hash = nullptr;
    BKE_collection_object_cache_free(ctx->bmain, master, 0);
    collections_synced(ctx);
  }
}

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
  return BKE_layer_collection_first_from_scene_collection(ctx->view_layer, collection);
}
EXPORT(main_layer_collection_active) LayerCollection *main_layer_collection_active(BlenderMain *ctx)
{
  return BKE_layer_collection_get_active(ctx->view_layer);
}
EXPORT(main_layer_collection_activate) void main_layer_collection_activate(BlenderMain *ctx, LayerCollection *lc)
{
  BKE_layer_collection_activate(ctx->view_layer, lc);
}
EXPORT(layer_collection_collection) Collection *layer_collection_collection(LayerCollection *lc) { return lc->collection; }

/* An object's base flags (eBaseFlags) and whether it is the active one, or -1 when it has no base. */
EXPORT(main_base_get) int main_base_get(BlenderMain *ctx, Object *ob)
{
  BKE_view_layer_synced_ensure(*ctx->bmain, ctx->scene, ctx->view_layer);
  const Base *base = base_of(ctx, ob);
  return base ? base->flag | (ctx->view_layer->basact == base ? 1 << 30 : 0) : -1;
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
  const short flag = base->flag, from_collection = base->flag_from_collection, visibility = ob->visibility_flag;
  /* Its collections' visibility is the view layer's sync's; an object they show can still be kept out of view. */
  if (!visible) {
    base->flag_from_collection = BASE_ENABLED_RENDER;
  }
  SET_FLAG_FROM_TEST(base->flag, hidden, BASE_HIDDEN);
  SET_FLAG_FROM_TEST(base->flag, select, BASE_SELECTED);
  SET_FLAG_FROM_TEST(ob->visibility_flag, hide_select, OB_HIDE_SELECT);
  BKE_base_eval_flags(base);
  ob->base_flag = base->flag;
  if (base->flag != flag || base->flag_from_collection != from_collection || ob->visibility_flag != visibility) {
    DEG_id_tag_update(&ctx->scene->id, ID_RECALC_BASE_FLAGS);
  }
  if (active) {
    ctx->view_layer->basact = base;
  }
  else if (ctx->view_layer->basact == base) {
    ctx->view_layer->basact = nullptr;
  }
}

/* An object's parent (null for none), parented to the object as a whole. */
EXPORT(object_parent_set) void object_parent_set(Object *ob, Object *parent)
{
  ob->parent = parent;
  ob->partype = PAROBJECT;
  DEG_id_tag_update(&ob->id, ID_RECALC_TRANSFORM);
  DEG_relations_tag_update(G_MAIN);
}

/* An object's mode (eObjectMode). */
EXPORT(object_mode_set) void object_mode_set(Object *ob, int mode)
{
  ob->mode = eObjectMode(mode);
  DEG_id_tag_update(&ob->id, ID_RECALC_SYNC_TO_EVAL);
}

/* port-override: Bylonder's objects have no parent inverse, so it folds into the object's own transform, keeping its
 * world matrix (evaluated). */
EXPORT(object_parent_inverse_fold) void object_parent_inverse_fold(Object *ob)
{
  unit_m4(ob->parentinv);
  BKE_object_apply_mat4(ob, ob->object_to_world().ptr(), true, true);
  DEG_id_tag_update(&ob->id, ID_RECALC_TRANSFORM);
}

/* An object placed at a world matrix (Blender's axes), its own transform made from it under its parent, as Blender's
 * transform applies a matrix (BKE_object_apply_mat4, keeping its rotation mode and Euler compatible). */
EXPORT(object_world_matrix_apply) void object_world_matrix_apply(Object *ob, const float *matrix)
{
  BKE_object_apply_mat4(ob, reinterpret_cast<const float(*)[4]>(matrix), true, true);
  DEG_id_tag_update(&ob->id, ID_RECALC_TRANSFORM);
}

/* Tags an ID for the depsgraph to evaluate again (IDRecalcFlag; 0 for all of it), after the editor wrote its DNA. */
EXPORT(id_tag_update) void id_tag_update(ID *id, unsigned int flags) { DEG_id_tag_update(id, flags); }
/* The relations between IDs changed (a parent, a modifier's target), which the depsgraph builds again. */
EXPORT(main_relations_tag) void main_relations_tag(BlenderMain *ctx) { DEG_relations_tag_update(ctx->bmain); }

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
EXPORT(main_cursor) float *main_cursor(BlenderMain *ctx) { return ctx->scene->cursor.location; }
EXPORT(main_pivot_point_set) void main_pivot_point_set(BlenderMain *ctx, int pivot_point)
{
  ctx->scene->toolsettings->transform_pivot_point = char(pivot_point);
}

/* What the depsgraph updated in its evaluations since the editor last took it: each original ID and its recalc flags
 * (IDRecalcFlag), as the editors' update callback sees them before they are cleared (ED_render_scene_update). */
static Map<ID *, unsigned int> updates;
static Vector<ID *> taken;
static void scene_updated(const DEGEditorUpdateContext *update_ctx, bool updated)
{
  if (!updated) {
    return;
  }
  DEGIDIterData data = {update_ctx->depsgraph, true};
  ITER_BEGIN (DEG_iterator_ids_begin, DEG_iterator_ids_next, DEG_iterator_ids_end, &data, ID *, id) {
    updates.lookup_or_add(DEG_get_original(id), 0) |= id->recalc;
  }
  ITER_END;
}

/* The scene's depsgraph, active (its evaluation writes back to the originals what the editors show). */
static Depsgraph *depsgraph_of(BlenderMain *ctx) { return CTX_data_depsgraph_pointer(ctx->C); }

/* Main evaluated by Blender's depsgraph for what was tagged since the last evaluation, as the window manager does
 * after each event (wm_event_do_depsgraph). */
EXPORT(main_evaluate) void main_evaluate(BlenderMain *ctx) { BKE_scene_graph_update_tagged(depsgraph_of(ctx), ctx->bmain); }

/* The IDs the depsgraph updated since the last call, taken: their count, then each one (main_update) and its flags. */
EXPORT(main_updates) int main_updates()
{
  taken.clear();
  for (ID *id : updates.keys()) {
    taken.append(id);
  }
  return taken.size();
}
EXPORT(main_update) ID *main_update(int index) { return taken[index]; }
EXPORT(main_update_recalc) unsigned int main_update_recalc(int index) { return updates.pop(taken[index]); }

/* A mesh object's Mesh replaced by one of the arrays bm_from_arrays takes; attributes are added after. */
EXPORT(object_mesh_set)
void object_mesh_set(Object *ob, int verts_num, const float3 *positions, int edges_num, const int2 *edges, int faces_num,
                     const int *face_offsets, const int *corner_verts, const int *corner_edges)
{
  Mesh *mesh = mesh_from_arrays(verts_num, positions, edges_num, edges, faces_num, face_offsets, corner_verts, corner_edges, nullptr);
  BKE_mesh_nomain_to_mesh(mesh, id_cast<Mesh *>(ob->data), ob);
  DEG_id_tag_update(&ob->id, ID_RECALC_GEOMETRY);
}

/* Adds an attribute of a domain (AttrDomain) and type (AttrType) to a mesh object's Mesh, from one value per element. */
EXPORT(object_mesh_attribute_add) bool object_mesh_attribute_add(Object *ob, const char *name, int domain, int type, const void *data)
{
  Mesh *mesh = id_cast<Mesh *>(ob->data);
  bke::MutableAttributeAccessor attributes = mesh->attributes_for_write();
  const CPPType &cpp_type = bke::attribute_type_to_cpp_type(bke::AttrType(type));
  const GSpan values(cpp_type, data, attributes.domain_size(bke::AttrDomain(domain)));
  DEG_id_tag_update(ob->data, ID_RECALC_GEOMETRY);
  if (!attributes.add(name, bke::AttrDomain(domain), bke::AttrType(type), bke::AttributeInitVArray(GVArray::from_span(values)))) {
    return false;
  }
  /* A 2D vector per face corner is a UV map: the first one the Mesh has is its active and default, as Blender's
   * Mesh.uv_layers.new makes it. */
  if (bke::AttrDomain(domain) == bke::AttrDomain::Corner && bke::AttrType(type) == bke::AttrType::Float2 &&
      mesh->active_or_default_uv_map_name().is_empty())
  {
    mesh->uv_maps_active_set(name);
    mesh->uv_maps_default_set(name);
  }
  return true;
}

/* A mesh object's Mesh, read through the header until the next call. */
EXPORT(object_mesh_extract) const ExtractionHeader *object_mesh_extract(BlenderMain *ctx, Object *ob)
{
  mesh_extraction(*id_cast<Mesh *>(ob->data), ctx->extraction);
  return &ctx->extraction;
}

/* An attribute's values in a mesh object's Mesh, or null; valid until the Mesh changes. One stored as a single value
 * (a read file's flat shading of every face) is given as one value per element, kept by name until the next call. */
EXPORT(object_mesh_attribute) const void *object_mesh_attribute(Object *ob, const char *name)
{
  static Map<std::string, GArray<>> materialized;
  const bke::GAttributeReader reader = id_cast<Mesh *>(ob->data)->attributes().lookup(name);
  if (!reader) {
    return nullptr;
  }
  if (reader.varray.is_span()) {
    return reader.varray.get_internal_span().data();
  }
  GArray<> &values = materialized.lookup_or_add_default(name);
  values = GArray<>(reader.varray.type(), reader.varray.size());
  reader.varray.materialize(values.data());
  return values.data();
}

/* An object's evaluated mesh (a mesh object's Mesh with its modifiers, a curve's or text's as Blender draws it), as the
 * depsgraph evaluated it, read through the header until the next call; null when it has none. */
EXPORT(object_mesh_eval) const ExtractionHeader *object_mesh_eval(BlenderMain *ctx, Object *ob)
{
  Depsgraph *depsgraph = depsgraph_of(ctx);
  BKE_scene_graph_evaluated_ensure(depsgraph, ctx->bmain);
  Object *evaluated = DEG_get_evaluated(depsgraph, ob);
  /* A curve without a surface draws as the wire of its evaluated curves (curve_to_wire_mesh, as Convert makes it). */
  bke::GeometrySet *geometry = ELEM(ob->type, OB_CURVES_LEGACY, OB_FONT) ? evaluated->runtime->geometry_set_eval : nullptr;
  if (geometry && !geometry->has_mesh() && geometry->has_curves()) {
    geometry->replace_mesh(bke::curve_to_wire_mesh(geometry->get_curves()->geometry.wrap()));
  }
  const Mesh *mesh = geometry ? geometry->get_mesh() : BKE_object_get_evaluated_mesh(evaluated);
  if (!mesh) {
    return nullptr;
  }
  mesh_extraction(*mesh, ctx->extraction);
  return &ctx->extraction;
}

/* A Blender matrix (column-major, Z up) written as Babylon's (row-major, Y up; main-view.js babylonMatrix). */
static void babylon_matrix(const float m[4][4], float *out)
{
  static const int axis[4] = {0, 2, 1, 3};
  for (int i = 0; i < 16; i++) {
    out[i] = m[axis[i >> 2]][axis[i & 3]];
  }
}

/* What Main's objects draw as instances, as Blender's draw engines draw them: the objects their Instancing makes (a
 * collection, their vertices or faces), their particle systems rendered as objects or collections and their evaluated
 * geometry's instances (object_duplilist), grouped by instancer and object, each a world matrix in Babylon's axes; their
 * particle systems' overlay (overlay_particle.hh), a shape at each particle drawn by Blender's own shaders from its
 * point data as the draw cache gives it (particle_batch_cache_ensure_pos: position, value, rotation, in Blender's axes);
 * and hair paths, a line segment's matrix per segment. A group is { instancer, ob (the object instanced, or null),
 * shape (ParticleShape), overlay (the viewport's only), first, count, draw size, color (rgb: its material's) }; its
 * instances' 16 floats are contiguous in one buffer. Valid until the next call; returns the number of groups. */
enum ParticleShape { SHAPE_OBJECT, SHAPE_DOT, SHAPE_CIRCLE, SHAPE_CROSS, SHAPE_AXIS, SHAPE_SEGMENT };
struct InstanceGroup {
  Object *instancer, *ob;
  int shape, overlay, first, count;
  float draw_size, color[3];
};
static Vector<InstanceGroup> instance_groups;
static Vector<float> instance_matrices;
static float *instance_matrix_add()
{
  instance_matrices.resize(instance_matrices.size() + 16);
  return instance_matrices.end() - 16;
}
static void instance_group_add(InstanceGroup group)
{
  group.count = instance_matrices.size() / 16 - group.first;
  if (group.count) {
    instance_groups.append(group);
  }
}
static void object_instances(Depsgraph *depsgraph, Object &ob, Object *evaluated)
{
  const bke::GeometrySet *geometry = evaluated->runtime->geometry_set_eval;
  if (!(evaluated->transflag & OB_DUPLI) && !(geometry && geometry->has_instances())) {
    return;
  }
  DupliList duplis;
  object_duplilist(depsgraph, evaluated, nullptr, duplis);
  Map<Object *, Vector<const DupliObject *>> grouped;
  for (const DupliObject &dupli : duplis) {
    /* Instances of geometry no object of Main's holds have nothing for the view to draw them with. */
    Object *instanced = DEG_get_original(dupli.ob);
    if (!dupli.no_draw && instanced && instanced != dupli.ob && instanced != &ob) {
      grouped.lookup_or_add_default(instanced).append(&dupli);
    }
  }
  for (const auto item : grouped.items()) {
    InstanceGroup group = {&ob, item.key, SHAPE_OBJECT, false, int(instance_matrices.size() / 16)};
    for (const DupliObject *dupli : item.value) {
      babylon_matrix(dupli->mat, instance_matrix_add());
    }
    instance_group_add(group);
  }
}
/* A hair path's segments, each the matrix that takes the segment shape (0 to 1 along Z) onto it. */
static void path_segments(ParticleCacheKey **cache, int total)
{
  for (int p = 0; p < total; p++) {
    const ParticleCacheKey *keys = cache[p];
    for (int k = 0; keys && k < keys->segments; k++) {
      float m[4][4] = {};
      sub_v3_v3v3(m[2], keys[k + 1].co, keys[k].co);
      copy_v3_v3(m[3], keys[k].co);
      m[3][3] = 1.0f;
      babylon_matrix(m, instance_matrix_add());
    }
  }
}
static void particle_shapes(Depsgraph *depsgraph, Object &ob, Object *evaluated)
{
  for (ParticleSystem &psys : evaluated->particlesystem) {
    const ParticleSettings *part = psys.part;
    const int draw_as = part->draw_as == PART_DRAW_REND ? part->ren_as : part->draw_as;
    if (!psys_check_enabled(evaluated, &psys, false) || ELEM(draw_as, PART_DRAW_NOT, PART_DRAW_OB, PART_DRAW_GR)) {
      continue;
    }
    const Material *ma = BKE_object_material_get_eval(evaluated, part->omat);
    InstanceGroup group = {&ob, nullptr, SHAPE_DOT, true, int(instance_matrices.size() / 16), 0, 0.0f, {0.6f, 0.6f, 0.6f}};
    if (ma) {
      copy_v3_v3(group.color, &ma->r);
    }
    if (draw_as == PART_DRAW_PATH) {
      /* Hair renders as strands where it renders as paths; drawn as paths only in the viewport, the overlay draws it. */
      group.shape = SHAPE_SEGMENT;
      group.overlay = part->ren_as != PART_DRAW_PATH;
      path_segments(psys.pathcache, psys.totcached);
      path_segments(psys.childcache, psys.totchildcache);
      instance_group_add(group);
      continue;
    }
    group.shape = draw_as == PART_DRAW_CIRC ? SHAPE_CIRCLE : draw_as == PART_DRAW_CROSS ? SHAPE_CROSS : draw_as == PART_DRAW_AXIS ? SHAPE_AXIS : SHAPE_DOT;
    group.draw_size = part->draw_size;
    ParticleSimulationData sim = {nullptr};
    sim.depsgraph = depsgraph;
    sim.scene = DEG_get_evaluated_scene(depsgraph);
    sim.ob = evaluated;
    sim.psys = &psys;
    sim.psmd = psys_get_modifier(evaluated, &psys);
    psys_sim_data_init(&sim);
    for (int p = 0; p < psys.totpart; p++) {
      ParticleKey state;
      state.time = DEG_get_ctime(depsgraph);
      if (!psys_get_particle_state(&sim, p, &state, false)) {
        continue;
      }
      const ParticleData &pa = psys.particles[p];
      const float value = part->draw_col == PART_DRAW_COL_VEL ? len_v3(state.vel) / part->color_vec_max :
                          part->draw_col == PART_DRAW_COL_ACC ?
                          len_v3v3(state.vel, pa.prev_state.vel) / ((state.time - pa.prev_state.time) * part->color_vec_max) : -1.0f;
      float *point = instance_matrix_add();
      std::fill_n(point, 16, 0.0f);
      copy_v3_v3(point, state.co);
      point[3] = value;
      copy_v4_v4(point + 4, state.rot);
    }
    psys_sim_data_free(&sim);
    instance_group_add(group);
  }
}
EXPORT(main_instances) int main_instances(BlenderMain *ctx)
{
  instance_groups.clear();
  instance_matrices.clear();
  Depsgraph *depsgraph = depsgraph_of(ctx);
  for (Object &ob : ctx->bmain->objects) {
    Object *evaluated = DEG_get_evaluated(depsgraph, &ob);
    if (evaluated && evaluated != &ob) {
      object_instances(depsgraph, ob, evaluated);
      particle_shapes(depsgraph, ob, evaluated);
    }
  }
  return instance_groups.size();
}
EXPORT(main_instance_groups) const InstanceGroup *main_instance_groups() { return instance_groups.data(); }
EXPORT(main_instance_matrices) const float *main_instance_matrices() { return instance_matrices.data(); }


/* The last extracted Mesh's material slot of each face (its material_index, 0-based), or null when all are the first. */
EXPORT(extracted_material_index) const int *extracted_material_index()
{
  static Array<int> materialized;
  const VArray<int> values = *extracted_mesh->attributes().lookup<int>("material_index", bke::AttrDomain::Face);
  if (!values) {
    return nullptr;
  }
  if (values.is_span()) {
    return values.get_internal_span().data();
  }
  materialized.reinitialize(values.size());
  values.materialize(materialized);
  return materialized.data();
}

/* An object's modifier stack, edited as Blender's modifier operators edit it (object_modifier.cc): a modifier added
 * last (type: ModifierType; with what some types need, such as a Skin's vertices), removed, moved to an index, renamed
 * (unique in the stack), copied after itself, and applied to the object's data, the result Blender's evaluation of
 * it alone. Each tags what it changes. */
static bool modifier_reported(ReportList &reports, bool done)
{
  BKE_reports_free(&reports);
  return done;
}
EXPORT(object_modifier_add) ModifierData *object_modifier_add(BlenderMain *ctx, Object *ob, int type)
{
  ReportList reports;
  BKE_reports_init(&reports, RPT_STORE);
  ModifierData *md = ed::object::modifier_add(&reports, ctx->bmain, ctx->scene, ob, nullptr, type);
  BKE_reports_free(&reports);
  return md;
}
EXPORT(object_modifier_remove) bool object_modifier_remove(BlenderMain *ctx, Object *ob, ModifierData *md)
{
  ReportList reports;
  BKE_reports_init(&reports, RPT_STORE);
  return modifier_reported(reports, ed::object::modifier_remove(&reports, ctx->bmain, ctx->scene, ob, md));
}
EXPORT(object_modifier_move) bool object_modifier_move(Object *ob, ModifierData *md, int index)
{
  ReportList reports;
  BKE_reports_init(&reports, RPT_STORE);
  return modifier_reported(reports, ed::object::modifier_move_to_index(&reports, RPT_WARNING, ob, md, index, true));
}
EXPORT(object_modifier_copy) bool object_modifier_copy(BlenderMain *ctx, Object *ob, ModifierData *md)
{
  ReportList reports;
  BKE_reports_init(&reports, RPT_STORE);
  return modifier_reported(reports, ed::object::modifier_copy(&reports, ctx->bmain, ctx->scene, ob, md));
}
EXPORT(object_modifier_rename) void object_modifier_rename(Object *ob, ModifierData *md, const char *name)
{
  STRNCPY_UTF8(md->name, name);
  BKE_modifier_unique_name(&ob->modifiers, md);
  DEG_id_tag_update(&ob->id, ID_RECALC_GEOMETRY);
}
EXPORT(object_modifier_apply) bool object_modifier_apply(BlenderMain *ctx, Object *ob, ModifierData *md)
{
  ReportList reports;
  BKE_reports_init(&reports, RPT_STORE);
  Depsgraph *depsgraph = depsgraph_of(ctx);
  BKE_scene_graph_evaluated_ensure(depsgraph, ctx->bmain);
  return modifier_reported(reports, ed::object::modifier_apply(ctx->bmain, &reports, depsgraph, ctx->scene, ob, md, ed::object::MODIFIER_APPLY_DATA, false, false));
}

/* Data that is not an object's: a Material or a World, whose users are those that use it. */
EXPORT(main_material_add) Material *main_material_add(BlenderMain *ctx, const char *name)
{
  Material *ma = BKE_material_add(ctx->bmain, name);
  id_us_min(&ma->id);
  return ma;
}
EXPORT(main_world_add) World *main_world_add(BlenderMain *ctx, const char *name)
{
  World *world = BKE_world_add(ctx->bmain, name);
  id_us_min(&world->id);
  return world;
}
EXPORT(main_id_remove) void main_id_remove(BlenderMain *ctx, ID *id) { BKE_id_delete(ctx->bmain, id); }
EXPORT(id_users) int id_users(const ID *id) { return id->us; }
EXPORT(id_fake_user) bool id_fake_user(const ID *id) { return ID_FAKE_USERS(id); }
EXPORT(id_fake_user_set) void id_fake_user_set_export(ID *id, bool fake)
{
  if (fake) {
    id_fake_user_set(id);
  }
  else {
    id_fake_user_clear(id);
  }
}

/* The scene's world (null for none), which it uses. */
EXPORT(main_scene_world_set) void main_scene_world_set(BlenderMain *ctx, World *world)
{
  if (ctx->scene->world == world) {
    return;
  }
  if (ctx->scene->world) {
    id_us_min(&ctx->scene->world->id);
  }
  ctx->scene->world = world;
  if (world) {
    id_us_plus(&world->id);
  }
  DEG_relations_tag_update(ctx->bmain);
}
EXPORT(main_scene_world) World *main_scene_world(BlenderMain *ctx) { return ctx->scene->world; }

/* An object's material slots, set whole (null for an empty slot), on its data as Blender assigns them by default. */
EXPORT(object_materials_set) void object_materials_set(BlenderMain *ctx, Object *ob, Material **materials, int count)
{
  BKE_object_material_array_assign(ctx->bmain, ob, &materials, count, false);
  DEG_id_tag_update(&ob->id, ID_RECALC_GEOMETRY);
  DEG_relations_tag_update(ctx->bmain);
}
EXPORT(object_materials) int object_materials(Object *ob, Material **r_materials)
{
  const int count = *BKE_object_material_len_p(ob);
  for (int i = 0; r_materials && i < count; i++) {
    r_materials[i] = BKE_object_material_get(ob, short(i + 1));
  }
  return count;
}

/* An ID's custom string property, for what only Bylonder has that a round trip needs; null when it has none. */
EXPORT(id_property_string_set) void id_property_string_set(ID *id, const char *name, const char *value)
{
  IDP_ReplaceInGroup(IDP_EnsureProperties(id), bke::idprop::create(name, StringRefNull(value)).release());
}
EXPORT(id_property_string) const char *id_property_string(const ID *id, const char *name)
{
  const IDProperty *prop = id->properties ? IDP_GetPropertyTypeFromGroup(id->properties, name, IDP_STRING) : nullptr;
  return prop ? IDP_string_get(prop) : nullptr;
}

/* The context's Main, scene and view layer after Blender's code replaced or re-read them (reading a file, loading an
 * undo step). */
EXPORT(main_context_refresh) void main_context_refresh(BlenderMain *ctx)
{
  ctx->bmain = CTX_data_main(ctx->C);
  ctx->scene = CTX_data_scene(ctx->C);
  ctx->view_layer = BKE_view_layer_default_view(ctx->scene);
  ctx->window.scene = ctx->scene;
  collections_synced(ctx);
}

/* A .blend opened as Blender's File > Open does without its UI (wm_file_read_post with G_FILE_NO_UI): read
 * (BLO_read_from_memory) and set up as the Main (BKE_blendfile_read_setup_readfile), whose scene and view layer become
 * the context's. Returns the warnings Blender reported, one per line, or null when the file could not be read. */
EXPORT(main_open) const char *main_open(BlenderMain *ctx, const void *data, int size)
{
  static std::string warnings;
  warnings.clear();
  ReportList reports;
  BKE_reports_init(&reports, RPT_STORE);
  BlendFileReadReport read_report = {};
  read_report.reports = &reports;
  BlendFileData *bfd = BLO_read_from_memory(data, size, BLO_READ_SKIP_USERDEF, &reports);
  if (bfd) {
    BlendFileReadParams params = {};
    params.skip_flags = BLO_READ_SKIP_USERDEF;
    G.fileflags |= G_FILE_NO_UI;
    /* The Main the file replaces, which setting it up frees, keeping its window manager (wm_file_read_setup_wm_init). */
    G_MAIN = ctx->bmain;
    BlendFileReadWMSetupData wm_setup_data = {ctx->wm};
    BKE_blendfile_read_setup_readfile(ctx->C, bfd, &params, &wm_setup_data, &read_report, false, nullptr);
    main_context_refresh(ctx);
  }
  for (const Report &report : reports.list.items_mutable()) {
    if (report.type >= RPT_WARNING) {
      warnings += std::string(report.message) + "\n";
    }
  }
  BKE_reports_free(&reports);
  return bfd ? warnings.c_str() : nullptr;
}

/* What saving a .blend reads from the Preferences: no thumbnail (the module has no GPU) and no backups. */
EXPORT(main_save_preferences) void main_save_preferences()
{
  U.file_preview_type = USER_FILE_PREVIEW_NONE;
  U.versions = 0;
}

/* An ID's shader node tree (a Material's or World's), built node by node: nodes by idname, which Blender's node types
 * (not in the module) recognize when the file is read, their sockets by type and identifier with their values, and
 * links. */
static bNodeTree &tree_of(ID *owner) { return *bke::node_tree_from_id(owner); }

EXPORT(node_tree_clear) void node_tree_clear(BlenderMain *ctx, ID *owner)
{
  bNodeTree &ntree = tree_of(owner);
  while (bNode *node = static_cast<bNode *>(ntree.nodes.first)) {
    bke::node_remove_node(ctx->bmain, ntree, *node, true, false);
  }
}

EXPORT(node_add) bNode *node_add(ID *owner, const char *idname, const char *name, float x, float y, float width)
{
  bNodeTree &ntree = tree_of(owner);
  bNode *node = bke::node_add_node(nullptr, ntree, UString(idname));
  STRNCPY(node->name, name);
  bke::node_unique_name(ntree, *node);
  node->location[0] = x;
  node->location[1] = y;
  node->width = width;
  return node;
}

/* A socket's value, in the default value its type allocates. */
static void socket_value_set(bNodeSocket &sock, const float *value, int count)
{
  switch (sock.type) {
    case SOCK_FLOAT:
      if (count) {
        sock.default_value_typed<bNodeSocketValueFloat>()->value = value[0];
      }
      break;
    case SOCK_RGBA:
      for (int i = 0; i < count && i < 4; i++) {
        sock.default_value_typed<bNodeSocketValueRGBA>()->value[i] = value[i];
      }
      break;
    case SOCK_VECTOR:
      for (int i = 0; i < count && i < 4; i++) {
        sock.default_value_typed<bNodeSocketValueVector>()->value[i] = value[i];
      }
      break;
    default:
      break;
  }
}

/* A socket of a type (eNodeSocketDatatype) and subtype (PropertySubType), with its value. A node type's declared
 * socket of that identifier is the one, as Blender makes them with the node; any other is added as a static socket,
 * with the value Blender's socket type would allocate. */
EXPORT(node_socket_add)
bNodeSocket *node_socket_add(ID *owner, bNode *node, bool output, int type, int subtype, const char *identifier, const char *name,
                             const float *value, int count)
{
  const eNodeSocketInOut in_out = output ? SOCK_OUT : SOCK_IN;
  if (bNodeSocket *declared = bke::node_find_socket(*node, in_out, UString(identifier))) {
    socket_value_set(*declared, value, count);
    return declared;
  }
  bNodeSocket *sock = bke::node_add_static_socket(tree_of(owner), *node, in_out, type, subtype, identifier, name);
  switch (type) {
    case SOCK_FLOAT: {
      bNodeSocketValueFloat *data = MEM_new<bNodeSocketValueFloat>(__func__);
      data->subtype = subtype;
      data->value = count ? value[0] : 0.0f;
      data->min = -FLT_MAX;
      data->max = FLT_MAX;
      sock->default_value = data;
      break;
    }
    case SOCK_RGBA: {
      bNodeSocketValueRGBA *data = MEM_new<bNodeSocketValueRGBA>(__func__);
      for (int i = 0; i < 4; i++) {
        data->value[i] = i < count ? value[i] : 1.0f;
      }
      sock->default_value = data;
      break;
    }
    case SOCK_VECTOR: {
      bNodeSocketValueVector *data = MEM_new<bNodeSocketValueVector>(__func__);
      data->subtype = subtype;
      data->dimensions = 3;
      for (int i = 0; i < count && i < 4; i++) {
        data->value[i] = value[i];
      }
      data->min = -FLT_MAX;
      data->max = FLT_MAX;
      sock->default_value = data;
      break;
    }
    default:
      break;
  }
  return sock;
}

EXPORT(node_link_add) void node_link_add(ID *owner, bNode *from, bNodeSocket *from_socket, bNode *to, bNodeSocket *to_socket)
{
  bke::node_add_link(tree_of(owner), *from, *from_socket, *to, *to_socket);
}

/* After the editor built an ID's node tree: Blender's tree update (link validity, socket availability), as editing it
 * through RNA runs it. */
EXPORT(node_tree_updated) void node_tree_updated(BlenderMain *ctx, ID *owner)
{
  BKE_ntree_update_tag_all(&tree_of(owner));
  BKE_main_ensure_invariants(*ctx->bmain, tree_of(owner).id);
}

/* An ID's node tree as JSON: each node's idname and name with its inputs' identifiers and values (numbers, or null),
 * and the links (from node, from socket, to node, to socket), until the next call. */
EXPORT(node_tree_describe) const char *node_tree_describe(ID *owner)
{
  static std::string text;
  text = "{\"nodes\":[";
  const bNodeTree &ntree = tree_of(owner);
  auto quoted = [](const char *s) { return std::string("\"") + s + "\""; };
  bool first = true;
  for (const bNode &node : ntree.nodes) {
    text += (first ? "" : ",") + std::string("{\"idname\":") + quoted(node.idname) + ",\"name\":" + quoted(node.name) + ",\"inputs\":{";
    first = false;
    bool first_socket = true;
    for (const bNodeSocket &sock : node.inputs) {
      std::string value = "null";
      if (sock.default_value && sock.type == SOCK_FLOAT) {
        value = std::to_string(static_cast<const bNodeSocketValueFloat *>(sock.default_value)->value);
      }
      else if (sock.default_value && (sock.type == SOCK_RGBA || sock.type == SOCK_VECTOR)) {
        const float *v = sock.type == SOCK_RGBA ? static_cast<const bNodeSocketValueRGBA *>(sock.default_value)->value
                                                : static_cast<const bNodeSocketValueVector *>(sock.default_value)->value;
        const int n = sock.type == SOCK_RGBA ? 4 : 3;
        value = "[";
        for (int i = 0; i < n; i++) {
          value += (i ? "," : "") + std::to_string(v[i]);
        }
        value += "]";
      }
      text += (first_socket ? "" : ",") + quoted(sock.identifier) + ":" + value;
      first_socket = false;
    }
    text += "}}";
  }
  text += "],\"links\":[";
  first = true;
  for (const bNodeLink &link : ntree.links) {
    text += (first ? "[" : ",[") + quoted(link.fromnode->name) + "," + quoted(link.fromsock->identifier) + "," + quoted(link.tonode->name) + "," +
            quoted(link.tosock->identifier) + "]";
    first = false;
  }
  text += "]}";
  return text.c_str();
}

/* port-override: the bundled startup file wm_files.cc reads a factory startup from; the module saves files and reads
 * none (Bylonder's scene is its own startup). */
extern "C" int datatoc_startup_blend_size = 0;
extern "C" const char datatoc_startup_blend[] = {0};

/* What the operators reach of Blender beyond the module. */

namespace blender {

/* port-override: the module has no shader nodes, so a new light gets no node tree (BKE_light_add); Bylonder's lights
 * draw without one. */
void nodes::node_tree_shader_default(const bContext * /*C*/, Main * /*bmain*/, ID * /*id*/) {}


/* As wm_window.cc defines it for the one window, whose screen has no 3D View of the module's to sync. */
void WM_windows_scene_data_sync(const ListBaseT<wmWindow> * /*win_lb*/, Scene * /*scene*/) {}

/* port-override: the module has no zlib (its calls would not link), so a gzip-compressed file is one it cannot
 * read, as when zlib reports an error; it reads no files anyway. */
FileReader *BLI_filereader_new_gzip(FileReader * /*base*/) { return nullptr; }

/* port-override: the module has no GPU materials, so a material's list of them is empty. */
void GPU_material_free(ListBaseT<LinkData> * /*gpumaterial*/) {}

/* port-override: the module has no OpenColorIO, so a new scene's color management names what Blender's bundled
 * configuration gives (its default display and sequencer role), which Bylonder's view settings then set. */
const char *IMB_colormanagement_role_colorspace_name_get(int /*role*/) { return "sRGB"; }
const char *IMB_colormanagement_display_get_default_name() { return "sRGB"; }
const ColorManagedDisplay *IMB_colormanagement_display_get_named(const char * /*name*/) { return nullptr; }
void IMB_colormanagement_validate_settings(const ColorManagedDisplaySettings * /*display_settings*/,
                                           ColorManagedViewSettings * /*view_settings*/)
{
}

/* As sequencer.cc defines it; the module has no sequencer. */
SequencerToolSettings *seq::tool_settings_init()
{
  SequencerToolSettings *tool_settings = MEM_new<SequencerToolSettings>("Sequencer tool settings");
  tool_settings->fit_method = SEQ_SCALE_TO_FIT;
  tool_settings->snap_mode = SEQ_SNAP_TO_STRIPS | SEQ_SNAP_TO_CURRENT_FRAME | SEQ_SNAP_TO_STRIP_HOLD | SEQ_SNAP_TO_MARKERS |
                             SEQ_SNAP_TO_RETIMING | SEQ_SNAP_TO_PREVIEW_BORDERS | SEQ_SNAP_TO_PREVIEW_CENTER |
                             SEQ_SNAP_TO_STRIPS_PREVIEW | SEQ_SNAP_TO_FRAME_RANGE;
  tool_settings->snap_flag = SEQ_SNAP_TO_ALL_CHANNEL_STRIPS;
  tool_settings->snap_distance = 15;
  tool_settings->overlap_mode = SEQ_OVERLAP_SHUFFLE;
  tool_settings->pivot_point = V3D_AROUND_LOCAL_ORIGINS;
  return tool_settings;
}

/* port-override: the module renders nothing and has no OpenColorIO, so opening a file frees no render results and
 * checks no color configuration. */
void RE_FreeAllRenderResults() {}
void RE_FreeInteractiveCompositorRenders() {}
void RE_FreeAllPersistentData() {}
void IMB_colormanagement_working_space_check(Main * /*bmain*/, bool /*for_undo*/, bool /*have_editable_assets*/) {}
void IMB_colormanagement_check_file_config(Main * /*bmain*/) {}

/* As blender.cc defines it, for a file opened: the old Main is freed (BKE_blender_globals_clear). */
void BKE_blender_globals_main_replace(Main *bmain)
{
  BKE_main_free(G_MAIN);
  bmain->is_global_main = true;
  G_MAIN = bmain;
}

/* As blender.cc defines it, for versioning that runs code on the Main it reads as the global one. */
Main *BKE_blender_globals_main_swap(Main *new_gmain)
{
  Main *old_gmain = G_MAIN;
  new_gmain->is_global_main = true;
  G_MAIN = new_gmain;
  old_gmain->is_global_main = false;
  return old_gmain;
}

/* port-override: the module has no OpenColorIO, so a read file's colors stay in their working space (Blender's default,
 * linear Rec.709, which Bylonder's colors are in). */
void IMB_colormanagement_working_space_init_default(Main * /*bmain*/) {}
void IMB_colormanagement_working_space_convert(Main * /*bmain*/, const Main * /*reference_bmain*/) {}

/* port-override: the module has no asset libraries, whose import method a read file is checked against. */
void AS_asset_library_import_method_ensure_valid(Main & /*bmain*/) {}



/* port-override: a read file's scenes are freed without the sequencer, sound or depsgraphs the module does not have;
 * Bylonder's scene keeps neither strips nor sounds. */
void seq::editing_free(Scene * /*scene*/, bool /*do_id_user*/) {}
void seq::tool_settings_free(SequencerToolSettings *tool_settings) { MEM_delete(tool_settings); }
void BKE_sound_destroy_scene(Scene * /*scene*/) {}
/* port-override: a read scene's strips are left out (their data is the sequencer's to read), as Bylonder has none. */
void seq::blend_read(BlendDataReader * /*reader*/, ListBaseT<Strip> *seqbase) { BLI_listbase_clear(seqbase); }
void seq::foreach_strip(ListBaseT<Strip> * /*seqbase*/, ForEachFunc /*callback*/, void * /*user_data*/) {}
void seq::foreach_strip(ListBaseT<Strip> * /*seqbase*/, FunctionRef<bool(Strip *)> /*callback*/) {}

/* port-override: the module's IDs are never assets, so none has an asset type's pre-save step (asset_mark_clear.cc). */
namespace ed::asset {
void pre_save_assets(Main * /*bmain*/) {}
}  // namespace ed::asset

/* port-override: the module has no file browser, whose bookmarks and recent directories a saved file updates. */
void ED_file_read_bookmarks() {}

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
