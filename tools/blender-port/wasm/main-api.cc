/* Blender's data outside Edit Mode: a Main holding Bylonder's objects and their data, one Scene with one ViewLayer
 * whose Bases hold the selection and the active object, and Main's window manager with one window whose screen
 * answers context members as Blender's screen context does (screen_context.cc) and runs its events (wm-api.cc). Main
 * owns the data (docs/model.md); Blender's depsgraph evaluates it, and Babylon draws what the evaluation updated
 * (src/blenkernel/main-view.js). Operators run by their own exec (operator_exec, on main_C).
 * Other subsystems keep their IDs in the same Main (main_bmain) and their object data on its objects (object_data). */
#include "BKE_armature.hh"
#include "BKE_camera.h"
#include "DNA_camera_types.h"
#include "BLI_rect.h"
#include "BKE_attribute.hh"
#include "BKE_collection.hh"
#include "BKE_duplilist.hh"
#include "BKE_curve_to_mesh.hh"
#include "BKE_curves.hh"
#include "BKE_pointcache.h"
#include "ED_info.hh"
#include "ED_particle.hh"
#include "BKE_geometry_set.hh"
#include "DNA_pointcloud_types.h"
#include "BKE_pointcloud.hh"
#include "BKE_geometry_set_instances.hh"
#include "BKE_instances.hh"
#include "BLI_math_matrix.hh"
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
#include "NOD_shader_nodes_inline.hh"
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
#include "BKE_deform.hh"
#include "BKE_object.hh"
#include "BKE_object_deform.h"
#include "BLI_array.hh"
#include "BKE_object_types.hh"
#include "BKE_paint.hh"
#include "BKE_paint_bvh.hh"
#include "BKE_particle.h"
#include "BKE_curves.hh"
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
#include "BPY_extern_python.hh"
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
#include <cstring>
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

/* As wm_file_read_post ends a file's reading (the startup file's too): the file read, and the asset lists to read
 * again, which the node tools' registration starts (register_node_group_operators). */
static void file_read_notify(BlenderMain *ctx)
{
  WM_event_add_notifier_ex(ctx->wm, &ctx->window, NC_WM | ND_FILEREAD, nullptr);
  WM_event_add_notifier_ex(ctx->wm, &ctx->window, NC_ASSET | ND_ASSET_LIST_READING, nullptr);
}

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
  /* As screen_add names it: an ID RNA types by its code (Screen, for the scripts' context.screen). */
  STRNCPY(ctx->screen.id.name, "SRLayout");
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
  file_read_notify(ctx);
  return ctx;
}

EXPORT(main_C) bContext *main_C(BlenderMain *ctx) { return ctx->C; }

void view3d_region_set(ScrArea &area, View3D &v3d, ARegion &region, RegionView3D &rv3d, const float *viewmat, const float *winmat, int winx,
                       int winy, bool is_persp);
void view3d_navigation_set(View3D &v3d, RegionView3D &rv3d, Scene *scene, const float *ofs, float dist, bool camera_view);
/* The 3D View the editor shows, as edit_context_view_set gives Edit Mode's: Object Mode's operators (transforms, view
 * operators) then act in its window region. */
EXPORT(main_view_set)
void main_view_set(BlenderMain *ctx, const float *viewmat, const float *winmat, int winx, int winy, bool is_persp, const float *ofs, float dist,
                   bool camera_view)
{
  ScrArea &area = ctx->view_area.area;
  if (BLI_listbase_is_empty(&area.spacedata)) {
    BLI_addtail(&ctx->screen.areabase, &area);
  }
  view3d_region_set(area, ctx->v3d, ctx->region, ctx->rv3d, viewmat, winmat, winx, winy, is_persp);
  view3d_navigation_set(ctx->v3d, ctx->rv3d, ctx->scene, ofs, dist, camera_view);
  CTX_wm_window_set(ctx->C, &ctx->window);
  CTX_wm_area_set(ctx->C, &area);
  CTX_wm_region_set(ctx->C, &ctx->region);
}
/* The view's projection after an operator (RV3D_CAMOB after Align Active Camera to View). */
EXPORT(main_view_persp) int main_view_persp(BlenderMain *ctx) { return ctx->rv3d.persp; }
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

/* The field of view a camera frames a winx by winy image with, along the side its sensor fits, as Blender's render
 * computes the view plane (BKE_camera_params_compute_viewplane), whether that side is the height, and the plane's
 * center. */
EXPORT(camera_view_fov) const float *camera_view_fov(Object *camera, int winx, int winy)
{
  static float result[4];
  CameraParams params;
  BKE_camera_params_init(&params);
  BKE_camera_params_from_object(&params, camera);
  BKE_camera_params_compute_viewplane(&params, winx, winy, 1.0f, 1.0f);
  const bool vertical = BKE_camera_sensor_fit(params.sensor_fit, winx, winy) == CAMERA_SENSOR_FIT_VERT;
  const rctf &plane = params.viewplane;
  result[0] = 2.0f * atanf((vertical ? BLI_rctf_size_y(&plane) : BLI_rctf_size_x(&plane)) / 2.0f / params.clip_start);
  result[1] = vertical;
  /* The view plane's center (its Shift) as a part of its half width and height. */
  result[2] = (plane.xmin + plane.xmax) / BLI_rctf_size_x(&plane);
  result[3] = (plane.ymin + plane.ymax) / BLI_rctf_size_y(&plane);
  return result;
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
EXPORT(object_mode) int object_mode(Object *ob) { return ob->mode; }
/* An object's mode, tagged only when it changes: the evaluated copy taken again from the original would lose what was
 * evaluated over time (a simulation's state). */
EXPORT(object_mode_set) void object_mode_set(Object *ob, int mode)
{
  if (ob->mode != eObjectMode(mode)) {
    ob->mode = eObjectMode(mode);
    DEG_id_tag_update(&ob->id, ID_RECALC_SYNC_TO_EVAL);
  }
}

/* port-override: Bylonder's objects have no parent inverse, so it folds into the object's own transform: parent
 * inverse times local, which keeps the world matrix whatever the parent (a bone too) and needs no evaluated matrix,
 * which a file just read does not have. */
EXPORT(object_parent_inverse_fold) void object_parent_inverse_fold(Object *ob)
{
  float local[4][4], folded[4][4];
  BKE_object_to_mat4(ob, local);
  mul_m4_m4m4(folded, ob->parentinv, local);
  unit_m4(ob->parentinv);
  BKE_object_apply_mat4(ob, folded, true, false);
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

/* The scene's statistics as the status bar shows them (ED_info_statusbar_string_ex with the statistics only), counted
 * anew: the window manager clears them on its notifiers. */
EXPORT(main_statistics) const char *main_statistics(BlenderMain *ctx)
{
  ED_info_stats_clear(ctx->wm, ctx->view_layer);
  return ED_info_statusbar_string_ex(ctx->bmain, ctx->scene, ctx->view_layer, STATUSBAR_SHOW_STATS);
}

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
  /* In Sculpt Mode Blender's engines draw the object's pbvh::Tree, its Mesh's own positions with the normals the draw
   * updates (draw_sculpt.cc sculpt_batches_get_ex), which a stroke changes without evaluating the object. */
  if (BKE_sculptsession_use_pbvh_draw(ob, nullptr)) {
    bke::pbvh::update_normals_from_eval(*evaluated, *bke::object::pbvh_get(*ob));
    mesh = id_cast<const Mesh *>(ob->data);
  }
  if (!mesh) {
    return nullptr;
  }
  mesh_extraction(*mesh, ctx->extraction);
  return &ctx->extraction;
}

/* The draw buffers of the mesh object_mesh_eval last gave (draw-mesh.cc), with the index buffers `what` asks for
 * (DrawRequest), valid until the next call or draw_buffers_free. */
/* `attributes`: the generic attributes its materials read, one name per line. */
EXPORT(object_draw_buffers) const DrawBuffers *object_draw_buffers(BlenderMain *ctx, Object *ob, int what, const char *attributes)
{
  Object *evaluated = DEG_get_evaluated(depsgraph_of(ctx), ob);
  Vector<std::string> names;
  for (const char *line = attributes; *line;) {
    const char *end = std::strchr(line, '\n');
    names.append(end ? std::string(line, end) : std::string(line));
    line = end ? end + 1 : line + names.last().size();
  }
  return extracted_mesh ? mesh_draw_buffers(*ctx->scene, *evaluated, *const_cast<Mesh *>(extracted_mesh), what, names) : nullptr;
}
EXPORT(draw_buffers_free) void draw_buffers_free_export() { draw_buffers_free(); }

/* What Weight Paint Mode shows of the vertex groups (draw_cache_extract.hh DRW_MeshWeightState). */
struct WeightState {
  int defgroup_active, defgroup_len;
  bool multipaint, auto_normalize, lock_relative;
  char alert_mode;
  Array<bool> sel, locked, unlocked;
  int sel_count = 0;
};

/* blender-port: draw_cache_impl_mesh.cc drw_mesh_weight_state_extract, in Weight Paint Mode. */
static WeightState weight_state(Object &ob, const Mesh &mesh, const ToolSettings &ts)
{
  WeightState ws{mesh.vertex_group_active_index - 1, BLI_listbase_count(&mesh.vertex_group_names)};
  ws.alert_mode = ts.weightuser;
  const auto take = [&](bool *flags, Array<bool> &into) {
    into = flags ? Array<bool>(Span(flags, ws.defgroup_len)) : Array<bool>();
    MEM_SAFE_DELETE(flags);
  };
  if (ts.multipaint) {
    take(BKE_object_defgroup_selected_get(&ob, ws.defgroup_len, &ws.sel_count), ws.sel);
    if (ws.sel_count > 1) {
      ws.multipaint = true;
      ws.auto_normalize = ts.auto_normalize;
      if (ME_USING_MIRROR_X_VERTEX_GROUPS(&mesh)) {
        BKE_object_defgroup_mirror_selection(&ob, ws.defgroup_len, ws.sel.data(), ws.sel.data(), &ws.sel_count);
      }
    }
    else {
      ws.sel_count = 0;
      ws.sel = {};
    }
  }
  if (ts.wpaint_lock_relative) {
    take(BKE_object_defgroup_lock_flags_get(&ob, ws.defgroup_len), ws.locked);
    take(BKE_object_defgroup_validmap_get(&ob, ws.defgroup_len), ws.unlocked);
    if (!ws.locked.is_empty() && BKE_object_defgroup_check_lock_relative(ws.locked.data(), ws.unlocked.data(), ws.defgroup_active) &&
        BKE_object_defgroup_check_lock_relative_multi(ws.defgroup_len, ws.locked.data(), ws.sel.data(), ws.sel_count))
    {
      ws.lock_relative = true;
      BKE_object_defgroup_split_locked_validmap(ws.defgroup_len, ws.locked.data(), ws.unlocked.data(), ws.locked.data(), ws.unlocked.data());
    }
  }
  return ws;
}

/* blender-port: extract_mesh_vbo_weights.cc evaluate_vertex_weight: a vertex's weight as the overlay shows it, -1 where
 * the alert (Zero Weights) marks it, -2 with no active group of several. */
static float vertex_weight(const MDeformVert *dvert, const WeightState &ws)
{
  if (ws.defgroup_active < 0 && ws.defgroup_len > 0) {
    return -2.0f;
  }
  float input = 0.0f;
  if (ws.multipaint) {
    input = BKE_defvert_multipaint_collective_weight(dvert, ws.defgroup_len, ws.sel.data(), ws.sel_count,
                                                     ws.auto_normalize || ws.lock_relative);
    if (input == 0.0f) {
      return -1.0f;
    }
  }
  else {
    input = BKE_defvert_find_weight(dvert, ws.defgroup_active);
    if (input == 0.0f && (ws.alert_mode == OB_DRAW_GROUPUSER_ACTIVE ||
                          (ws.alert_mode == OB_DRAW_GROUPUSER_ALL && BKE_defvert_is_weight_zero(dvert, ws.defgroup_len))))
    {
      return -1.0f;
    }
  }
  if (ws.lock_relative) {
    input = BKE_defvert_lock_relative_weight(input, dvert, ws.defgroup_len, ws.locked.data(), ws.unlocked.data());
  }
  return std::clamp(input, 0.0f, 1.0f);
}

/* The weight of each vertex of the mesh object_mesh_eval last gave, as Weight Paint Mode's overlay draws it
 * (extract_weights: its weight in the active vertex group, or its alert); valid until the next call. */
EXPORT(mesh_paint_weights) const float *mesh_paint_weights(BlenderMain *ctx, Object *ob)
{
  static Vector<float> weights;
  const Mesh &mesh = *extracted_mesh;
  const Span<MDeformVert> dverts = mesh.deform_verts();
  const WeightState ws = weight_state(*ob, mesh, *ctx->scene->toolsettings);
  const float none = ws.alert_mode == OB_DRAW_GROUPUSER_NONE ? 0.0f : -1.0f;
  weights.resize(mesh.verts_num);
  for (const int vert : IndexRange(mesh.verts_num)) {
    weights[vert] = dverts.is_empty() || ws.defgroup_active == -1 ? none : vertex_weight(&dverts[vert], ws);
  }
  return weights.data();
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
 * point data as the draw cache gives it (particle_batch_cache_ensure_pos: position, value, rotation, in Blender's
 * axes). Geometry instances of a mesh no object holds are grouped by their Mesh (data, drawn as main_instance_mesh
 * gives it), at world matrices in its first material. Point clouds are main_pointclouds', hair is curves
 * (main_curves). A group is { instancer, ob (the object instanced, or null), shape (InstanceShape), overlay
 * (the viewport's only), first, count, draw size, color (rgb: its material's), data, material }; its instances' 16
 * floats are contiguous in one buffer. Valid until the next call; returns the number of groups. */
enum InstanceShape { SHAPE_OBJECT, SHAPE_DOT, SHAPE_CIRCLE, SHAPE_CROSS, SHAPE_AXIS, SHAPE_MESH };
struct InstanceGroup {
  Object *instancer, *ob;
  int shape, overlay, first, count;
  float draw_size, color[3];
  const ID *data;
  const Material *material;
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
/* The first material of geometry an instance draws (its own slots, as the draw engines take a dupli's data's). */
/* A data-block's first material, as Main holds it: a geometry nodes mesh's slots may start empty (Set Material appends
 * to an Ico Sphere's empty slot) and an evaluated mesh's point to evaluated copies. */
static const Material *data_material(const ID *data)
{
  const short *len = BKE_id_material_len_p(const_cast<ID *>(data));
  Material **materials = len ? *BKE_id_material_array_p(const_cast<ID *>(data)) : nullptr;
  for (int i = 0; materials && i < *len; i++) {
    if (materials[i]) {
      return DEG_get_original(materials[i]);
    }
  }
  return nullptr;
}

/* The point clouds Main's objects draw (an evaluated geometry's, its instances' too), as Workbench and EEVEE draw
 * point clouds: a sphere at each point (draw_pointcloud_lib.glsl). A record is { instancer, pointcloud, material (its
 * first), object_to_world (Babylon's axes), first point, points }; each point is 4 floats, its position (Blender's
 * axes, the point cloud's space) and radius. Valid until the next main_instances; main_pointclouds returns the count. */
struct PointCloudDraw {
  Object *instancer;
  const PointCloud *pointcloud;
  const Material *material;
  float object_to_world[16];
  int first, points;
};
static Vector<PointCloudDraw> pointcloud_draws;
static Vector<float4> pointcloud_points;
static void pointcloud_add(Object &ob, const PointCloud &pointcloud, const float4x4 &transform)
{
  PointCloudDraw draw = {&ob, &pointcloud, data_material(&pointcloud.id), {}, int(pointcloud_points.size()), int(pointcloud.totpoint)};
  babylon_matrix(transform.ptr(), draw.object_to_world);
  const Span<float3> positions = pointcloud.positions();
  const VArray<float> radii = pointcloud.radius();
  pointcloud_points.reserve(pointcloud_points.size() + positions.size());
  for (const int i : positions.index_range()) {
    pointcloud_points.append(float4(positions[i], radii[i]));
  }
  if (draw.points) {
    pointcloud_draws.append(draw);
  }
}

/* Where geometry nodes' instances are, read from the geometry's instances without a dupli per instance: by object, and
 * by the mesh they instance, each a world matrix; the point clouds in the geometry and its instances. The object's own
 * mesh is the view's (object_mesh_eval).
 * blender-port: source/blender/blenkernel/intern/object_dupli.cc make_duplis_geometry_set_impl, its composition of the
 * parent, instance and collection offset transforms (a static function, so not callable). */
struct GeometryInstances {
  Map<Object *, Vector<float4x4>> objects;
  Map<const ID *, Vector<float4x4>> meshes;
};
static void geometry_instances(Object &ob, const Object &evaluated, const bke::GeometrySet &geometry, const float4x4 &transform,
                               const bool is_instance, GeometryInstances &found)
{
  if (is_instance && geometry.has_mesh()) {
    found.meshes.lookup_or_add_default(&geometry.get_mesh()->id).append(transform);
  }
  if (geometry.has_pointcloud()) {
    pointcloud_add(ob, *geometry.get_pointcloud(), transform);
  }
  const bke::Instances *instances = geometry.get_instances();
  if (!instances) {
    return;
  }
  const Span<float4x4> transforms = instances->transforms();
  const Span<int> handles = instances->reference_handles();
  const Span<bke::InstanceReference> references = instances->references();
  for (const int i : transforms.index_range()) {
    const bke::InstanceReference &reference = references[handles[i]];
    const float4x4 instance = transform * transforms[i];
    switch (reference.type()) {
      case bke::InstanceReference::Type::Object:
        found.objects.lookup_or_add_default(DEG_get_original(&reference.object())).append(instance);
        break;
      case bke::InstanceReference::Type::Collection: {
        Collection &collection = reference.collection();
        const float4x4 collection_matrix = instance * math::from_location<float4x4>(-float3(collection.instance_offset));
        FOREACH_COLLECTION_VISIBLE_OBJECT_RECURSIVE_BEGIN (&collection, object, DAG_EVAL_VIEWPORT) {
          if (object != &evaluated) {
            found.objects.lookup_or_add_default(DEG_get_original(object)).append(collection_matrix * object->object_to_world());
          }
        }
        FOREACH_COLLECTION_VISIBLE_OBJECT_RECURSIVE_END;
        break;
      }
      case bke::InstanceReference::Type::GeometrySet:
        geometry_instances(ob, evaluated, reference.geometry_set(), instance, true, found);
        break;
      case bke::InstanceReference::Type::None:
        break;
    }
  }
}
/* Groups of world matrices, contiguous in the one buffer: by the object instanced, or by the mesh. */
template<typename Key> static void matrix_groups(Object &ob, const Map<Key, Vector<float4x4>> &groups, const int shape)
{
  for (const auto item : groups.items()) {
    InstanceGroup group = {&ob, nullptr, shape, false, int(instance_matrices.size() / 16)};
    if constexpr (std::is_same_v<Key, Object *>) {
      group.ob = item.key;
    }
    else {
      group.data = item.key;
      group.material = data_material(item.key);
    }
    instance_matrices.reserve(instance_matrices.size() + item.value.size() * 16);
    for (const float4x4 &matrix : item.value) {
      babylon_matrix(matrix.ptr(), instance_matrix_add());
    }
    instance_group_add(group);
  }
}
/* An evaluated geometry with instances or components besides the object's own by geometry_instances, as
 * object_dupli.cc's generator choice prefers it; else classic instancing (vertices, faces, a collection) by
 * object_duplilist. */
static void object_instances(Depsgraph *depsgraph, Object &ob, Object *evaluated)
{
  const bke::GeometrySet *geometry = evaluated->runtime->geometry_set_eval;
  if (geometry && bke::object_has_geometry_set_instances(*evaluated)) {
    GeometryInstances found;
    geometry_instances(ob, *evaluated, *geometry, evaluated->object_to_world(), false, found);
    matrix_groups(ob, found.objects, SHAPE_OBJECT);
    matrix_groups(ob, found.meshes, SHAPE_MESH);
    return;
  }
  if (!(evaluated->transflag & OB_DUPLI)) {
    return;
  }
  DupliList duplis;
  object_duplilist(depsgraph, evaluated, nullptr, duplis);
  Map<Object *, Vector<float4x4>> objects;
  for (const DupliObject &dupli : duplis) {
    Object *instanced = DEG_get_original(dupli.ob);
    if (!dupli.no_draw && instanced && instanced != dupli.ob && instanced != &ob) {
      objects.lookup_or_add_default(instanced).append(float4x4(dupli.mat));
    }
  }
  matrix_groups(ob, objects, SHAPE_OBJECT);
}
static void particle_shapes(Depsgraph *depsgraph, Object &ob, Object *evaluated)
{
  for (ParticleSystem &psys : evaluated->particlesystem) {
    const ParticleSettings *part = psys.part;
    const int draw_as = part->draw_as == PART_DRAW_REND ? part->ren_as : part->draw_as;
    if (!psys_check_enabled(evaluated, &psys, false) || ELEM(draw_as, PART_DRAW_NOT, PART_DRAW_OB, PART_DRAW_GR, PART_DRAW_PATH)) {
      continue;
    }
    const Material *ma = BKE_object_material_get_eval(evaluated, part->omat);
    InstanceGroup group = {&ob, nullptr, SHAPE_DOT, true, int(instance_matrices.size() / 16), 0, 0.0f, {0.6f, 0.6f, 0.6f}};
    if (ma) {
      copy_v3_v3(group.color, &ma->r);
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
      /* blender-port: draw_cache_impl_particles.cc particle_batch_cache_ensure_pos. */
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
  pointcloud_draws.clear();
  pointcloud_points.clear();
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
/* An object's dupli list (object_duplilist), the reference main_instances is checked against: each dupli the object
 * instanced (its original, data null) or the mesh it instances (ob null), at its world matrix in Babylon's axes, the
 * object's own mesh left out. Valid until the next call; returns their count. */
struct DupliRecord {
  Object *ob;
  const ID *data;
  float matrix[16];
};
static Vector<DupliRecord> dupli_records;
EXPORT(main_duplis) int main_duplis(BlenderMain *ctx, Object *ob)
{
  dupli_records.clear();
  Depsgraph *depsgraph = depsgraph_of(ctx);
  Object *evaluated = DEG_get_evaluated(depsgraph, ob);
  const bke::GeometrySet *own = evaluated->runtime->geometry_set_eval;
  const ID *own_mesh = own && own->has_mesh() ? &own->get_mesh()->id : nullptr;
  DupliList duplis;
  object_duplilist(depsgraph, evaluated, nullptr, duplis);
  for (const DupliObject &dupli : duplis) {
    Object *instanced = DEG_get_original(dupli.ob);
    DupliRecord record = {};
    if (instanced && instanced != dupli.ob && instanced != ob) {
      record.ob = instanced;
    }
    else if (dupli.ob_data && dupli.ob_data != own_mesh && GS(dupli.ob_data->name) == ID_ME) {
      record.data = dupli.ob_data;
    }
    else {
      continue;
    }
    babylon_matrix(dupli.mat, record.matrix);
    dupli_records.append(record);
  }
  return dupli_records.size();
}
EXPORT(main_dupli_records) const DupliRecord *main_dupli_records() { return dupli_records.data(); }
EXPORT(main_pointclouds) int main_pointclouds() { return pointcloud_draws.size(); }
EXPORT(main_pointcloud_draws) const PointCloudDraw *main_pointcloud_draws() { return pointcloud_draws.data(); }
EXPORT(main_pointcloud_points) const float4 *main_pointcloud_points() { return pointcloud_points.data(); }
/* The Mesh of a SHAPE_MESH group, read through the header until the next call. */
EXPORT(main_instance_mesh) const ExtractionHeader *main_instance_mesh(BlenderMain *ctx, const Mesh *mesh)
{
  mesh_extraction(*mesh, ctx->extraction);
  return &ctx->extraction;
}

/* The curves Main's objects draw as Blender's draw engines draw curves (draw_curves_lib.glsl): the curves of their
 * evaluated geometry (a Curves object's, geometry nodes' output; draw_cache_impl_curves.cc
 * CurvesEvalCache::ensure_positions, its evaluation Blender's own CurvesGeometry), and their particle systems'
 * hair, by its render type (the render engines') or viewport display (the overlay's and Workbench's), each its
 * strands' points as the draw cache gives them, position (object space) and radius from the settings' root, tip and
 * shape (draw_cache_impl_particles.cc CurvesEvalCache::ensure_positions), subdivided as the scene's Hair settings ask
 * by Blender's Catmull-Rom evaluation, with the indirection Blender's topology pass makes for its strips or cylinders
 * (draw_curves_topology_comp.glsl, here on the CPU). A curves record is { ob, system, render (drawn by the render
 * engines), viewport (by Workbench, and the overlay in Wireframe), overlay (by the overlay always), material (the slot's), face_per_segment, first point, points, first indirection,
 * indirections, first curve, curves, object_to_world (Blender's axes) }; each point also has its time along its curve and
 * each curve its length (draw_curves_length_intercept_comp.glsl), Hair Info's Intercept and Length. Valid until the next call; returns their count. */
struct CurvesDraw {
  Object *ob;
  int system, render, viewport, overlay;
  Material *material;
  int face_per_segment, first_point, points, first_indirection, indirections, first_curve, curves;
  float object_to_world[16];
};
static Vector<CurvesDraw> curves_draws;
static Vector<float> curves_pos_rad;
static Vector<int> curves_indirection;
static Vector<float> curves_time, curves_length;
/* blender-port: draw_curves_length_intercept_comp.glsl evaluate_length_and_time, for curves that are not cyclic. */
static void curves_length_intercept(Span<float3> positions)
{
  const int first = curves_time.size();
  float distance_along_curve = 0.0f;
  curves_time.append(0.0f);
  for (int i = 1; i < positions.size(); i++) {
    distance_along_curve += math::distance(positions[i], positions[i - 1]);
    curves_time.append(distance_along_curve);
  }
  for (int i = 1; i < positions.size(); i++) {
    curves_time[first + i] /= distance_along_curve;
  }
  curves_length.append(distance_along_curve);
}
/* blender-port: draw_cache_impl_particles.cc hair_shape_radius (copied from cycles). */
static float hair_shape_radius(float shape, float root, float tip, float time)
{
  float radius = 1.0f - time;
  radius = shape < 0.0f ? powf(radius, 1.0f + shape) : powf(radius, 1.0f / (1.0f - shape));
  return (radius * (root - tip)) + tip;
}
/* blender-port: draw_curves_topology_comp.glsl, for curves that are not cyclic (WebGL has no compute shaders). */
static void curves_topology(int curve, int points, bool is_ribbon)
{
  constexpr int end_of_curve = INT_MAX;
  const int count = points + (is_ribbon ? 1 : -1);
  for (int i = 0; i < count; i++) {
    curves_indirection.append(is_ribbon && i == count - 1 ? end_of_curve : i == 0 ? curve : -i);
  }
}
/* blender-port: draw_hair.cc hair_sub_pass_setup, the faces per segment of the scene's hair shape. */
static int hair_face_per_segment(const Scene &scene)
{
  return scene.r.hair_type == SCE_HAIR_SHAPE_STRAND ? 0 : scene.r.hair_type == SCE_HAIR_SHAPE_CYLINDER ? 3 : 1;
}
/* A curve's evaluated points (object space) and radii into the buffers, with its time, length and topology. */
static void curves_append(int curve, Span<float3> positions, Span<float> radii, const int face_per_segment)
{
  for (const int j : positions.index_range()) {
    curves_pos_rad.extend({positions[j].x, positions[j].y, positions[j].z, radii[j]});
  }
  curves_length_intercept(positions);
  curves_topology(curve, positions.size(), face_per_segment < 2);
}
static CurvesDraw curves_draw_begin(Object &ob, Object *evaluated, int system, bool render, bool viewport, bool overlay, Material *material, int face_per_segment)
{
  /* Main's Material, which the view knows, not the evaluated object's copy of it. */
  material = material ? reinterpret_cast<Material *>(DEG_get_original_id(&material->id)) : nullptr;
  CurvesDraw draw = {&ob, system, render, viewport, overlay, material, face_per_segment,
                     int(curves_pos_rad.size() / 4), 0, int(curves_indirection.size()), 0, int(curves_length.size()), 0};
  copy_m4_m4(reinterpret_cast<float(*)[4]>(draw.object_to_world), evaluated->object_to_world().ptr());
  return draw;
}
static void curves_draw_end(CurvesDraw &draw)
{
  draw.points = curves_pos_rad.size() / 4 - draw.first_point;
  draw.indirections = curves_indirection.size() - draw.first_indirection;
  draw.curves = curves_length.size() - draw.first_curve;
  if (draw.points) {
    curves_draws.append(draw);
  }
}
/* A Curves object's evaluated curves, drawn by every engine (workbench_engine.cc, eevee_instance.cc: OB_CURVES only; a
 * legacy curve's evaluated Curves are its wire, draw_cache_impl_curve.cc curve_eval); a cyclic curve's first point again
 * after its last, as Blender's evaluated buffer holds it (evaluated_point_count_with_cyclic). System is -1. */
static void curves_geometry(const Scene &scene, Object &ob, Object *evaluated)
{
  if (ob.type != OB_CURVES) {
    return;
  }
  const bke::GeometrySet *geometry = evaluated->runtime->geometry_set_eval;
  const Curves *curves_id = geometry ? geometry->get_curves() : nullptr;
  if (!curves_id) {
    return;
  }
  const bke::CurvesGeometry &curves = curves_id->geometry.wrap();
  const int face_per_segment = hair_face_per_segment(scene);
  CurvesDraw draw = curves_draw_begin(ob, evaluated, -1, true, true, false, BKE_object_material_get(evaluated, 1), face_per_segment);
  curves.ensure_can_interpolate_to_evaluated();
  const Span<float3> positions = curves.evaluated_positions();
  Array<float> radii(positions.size());
  curves.interpolate_to_evaluated(VArraySpan<float>(curves.radius()), radii.as_mutable_span());
  const OffsetIndices points_by_curve = curves.evaluated_points_by_curve();
  const VArray<bool> cyclic = curves.cyclic();
  for (const int curve : curves.curves_range()) {
    const IndexRange points = points_by_curve[curve];
    Vector<float3> curve_positions(positions.slice(points));
    Vector<float> curve_radii(radii.as_span().slice(points));
    if (cyclic[curve] && points.size() > 1) {
      curve_positions.append(curve_positions.first());
      curve_radii.append(curve_radii.first());
    }
    curves_append(curve, curve_positions, curve_radii, face_per_segment);
  }
  curves_draw_end(draw);
}
static void particle_hair(const Scene &scene, Object &ob, Object *evaluated)
{
  int index = 0;
  for (ParticleSystem &psys : evaluated->particlesystem) {
    const ParticleSettings &part = *psys.part;
    const int system = index++;
    const int viewport_as = part.draw_as == PART_DRAW_REND ? part.ren_as : part.draw_as;
    if (!psys_check_enabled(evaluated, &psys, false) || (viewport_as != PART_DRAW_PATH && part.ren_as != PART_DRAW_PATH)) {
      continue;
    }
    const int face_per_segment = hair_face_per_segment(scene);
    CurvesDraw draw = curves_draw_begin(ob, evaluated, system, part.ren_as == PART_DRAW_PATH, viewport_as == PART_DRAW_PATH, part.draw_as == PART_DRAW_PATH,
                                        BKE_object_material_get(evaluated, part.omat), face_per_segment);
    const float root = part.rad_root * part.rad_scale * 0.5f, tip = part.rad_tip * part.rad_scale * 0.5f;
    const bool close_tip = part.shape_flag & PART_SHAPE_CLOSE_TIP;
    const int resolution = 1 << scene.r.hair_subdiv;
    const bool display_parent = !psys.childcache || (part.draw & PART_DRAW_PARENT);
    int curve = 0;
    const auto strand = [&](const ParticleCacheKey *keys) {
      const int size = keys->segments + 1;
      Array<float3> positions(size);
      Array<float> radii(size);
      for (int j = 0; j < size; j++) {
        mul_v3_m4v3(positions[j], psys.imat, keys[j].co);
        radii[j] = close_tip && j == size - 1 ? 0.0f : hair_shape_radius(part.shape, root, tip, keys[j].time);
      }
      const int evaluated = size > 1 ? bke::curves::catmull_rom::calculate_evaluated_num(size, false, resolution) : 1;
      Array<float3> evaluated_positions(evaluated);
      Array<float> evaluated_radii(evaluated);
      if (resolution > 1 && size > 1) {
        bke::curves::catmull_rom::interpolate_to_evaluated(GSpan(positions.as_span()), false, resolution, GMutableSpan(evaluated_positions.as_mutable_span()));
        bke::curves::catmull_rom::interpolate_to_evaluated(GSpan(radii.as_span()), false, resolution, GMutableSpan(evaluated_radii.as_mutable_span()));
      }
      else {
        evaluated_positions = positions;
        evaluated_radii = radii;
      }
      curves_append(curve++, evaluated_positions, evaluated_radii, face_per_segment);
    };
    for (int p = 0; display_parent && psys.pathcache && p < psys.totpart; p++) {
      strand(psys.pathcache[p]);
    }
    for (int c = 0; psys.childcache && c < psys.totchild * part.disp / 100; c++) {
      strand(psys.childcache[c]);
    }
    curves_draw_end(draw);
  }
}
EXPORT(main_curves) int main_curves(BlenderMain *ctx)
{
  curves_draws.clear();
  curves_pos_rad.clear();
  curves_indirection.clear();
  curves_time.clear();
  curves_length.clear();
  Depsgraph *depsgraph = depsgraph_of(ctx);
  for (Object &ob : ctx->bmain->objects) {
    Object *evaluated = DEG_get_evaluated(depsgraph, &ob);
    if (evaluated && evaluated != &ob) {
      curves_geometry(*ctx->scene, ob, evaluated);
      particle_hair(*ctx->scene, ob, evaluated);
    }
  }
  return curves_draws.size();
}
EXPORT(main_curves_draws) const CurvesDraw *main_curves_draws() { return curves_draws.data(); }
EXPORT(main_curves_pos_rad) const float *main_curves_pos_rad() { return curves_pos_rad.data(); }
EXPORT(main_curves_indirection) const int *main_curves_indirection() { return curves_indirection.data(); }
EXPORT(main_curves_time) const float *main_curves_time() { return curves_time.data(); }
EXPORT(main_curves_length) const float *main_curves_length() { return curves_length.data(); }

/* Particle Edit Mode as Blender's overlay draws it (overlay_particle.hh edit_object_sync): the edited system's
 * strands from the edit's path cache, each point with its selection (draw_cache_impl_particles.cc
 * particle_batch_cache_fill_segments_edit, or the key weight when the brush paints weights), as line strips that
 * restart at each strand's end, and its keys, the inner ones and the tips, with theirs (_ensure_edit_inner_pos,
 * _ensure_edit_tip_pos), all in world space. The record is { strands, strand indices, inner points, tip points, flags:
 * 1 use weight, 2 show inner points, 4 show tips }; points are { position, selection }. Valid until the next call;
 * returns whether an object is in Particle Edit Mode with an edit. */
struct ParticleEdit {
  int strands, indices, inner, tips, flags;
};
static ParticleEdit particle_edit;
static Vector<float> particle_edit_points;
static Vector<uint32_t> particle_edit_indices;
static void edit_point(const float co[3], float selection) { particle_edit_points.extend({co[0], co[1], co[2], selection}); }
EXPORT(main_particle_edit) bool main_particle_edit(BlenderMain *ctx)
{
  particle_edit = {};
  particle_edit_points.clear();
  particle_edit_indices.clear();
  Depsgraph *depsgraph = depsgraph_of(ctx);
  Object *ob = BKE_view_layer_active_object_get(ctx->view_layer);
  PTCacheEdit *edit = ob && (ob->mode & OB_MODE_PARTICLE_EDIT) ? PE_create_current(depsgraph, ctx->scene, ob) : nullptr;
  if (!edit || !edit->psys) {
    return false;
  }
  if (!edit->pathcache) {
    psys_cache_edit_paths(depsgraph, ctx->scene, ob, edit, DEG_get_ctime(depsgraph), false);
  }
  const ParticleEditSettings &pset = ctx->scene->toolsettings->particle;
  const bool use_weight = pset.brushtype == PE_BRUSH_WEIGHT;
  const ParticleData *particles = use_weight ? edit->psys->particles : nullptr;
  for (int i = 0; edit->pathcache && i < edit->totcached; i++) {
    const ParticleCacheKey *path = edit->pathcache[i];
    if (path->segments <= 0) {
      continue;
    }
    for (int j = 0; j <= path->segments; j++) {
      const float t = float(j) / path->segments;
      float selection = path[j].col[0];
      if (particles) {
        /* blender-port: draw_cache_impl_particles.cc particle_key_weight. */
        const ParticleData &pa = particles[i];
        const float interp = t == 1.0f ? 0.0f : t * (pa.totkey - 1), weight = t == 1.0f ? pa.hair[pa.totkey - 1].weight :
            pa.hair[int(interp)].weight + (interp - floorf(interp)) * (pa.hair[int(interp) + 1].weight - pa.hair[int(interp)].weight);
        selection = weight < 1.0f ? weight : 1.0f;
      }
      particle_edit_indices.append(particle_edit_points.size() / 4);
      edit_point(path[j].co, selection);
    }
    particle_edit_indices.append(UINT32_MAX);
  }
  particle_edit.strands = particle_edit_points.size() / 4;
  particle_edit.indices = particle_edit_indices.size();
  for (const bool tips : {false, true}) {
    for (int p = 0; p < edit->totpoint; p++) {
      const PTCacheEditPoint &point = edit->points[p];
      if (point.flag & PEP_HIDE) {
        continue;
      }
      for (int k = tips ? point.totkey - 1 : 0; k < (tips ? point.totkey : point.totkey - 1); k++) {
        edit_point(point.keys[k].world_co, point.keys[k].flag & PEK_SELECT ? 1.0f : 0.0f);
      }
    }
    (tips ? particle_edit.tips : particle_edit.inner) = particle_edit_points.size() / 4 - particle_edit.strands - (tips ? particle_edit.inner : 0);
  }
  particle_edit.flags = (use_weight ? 1 : 0) | (pset.selectmode == SCE_SELECT_POINT ? 2 : 0) | (ELEM(pset.selectmode, SCE_SELECT_POINT, SCE_SELECT_END) ? 4 : 0);
  return true;
}
EXPORT(main_particle_edit_record) const ParticleEdit *main_particle_edit_record() { return &particle_edit; }
EXPORT(main_particle_edit_points) const float *main_particle_edit_points() { return particle_edit_points.data(); }
EXPORT(main_particle_edit_indices) const uint32_t *main_particle_edit_indices() { return particle_edit_indices.data(); }
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

/* A color attribute of the mesh object_mesh_eval last gave (its active one when name is null) per face corner, in
 * scene linear RGBA as the draw cache extracts it for the engines (a byte color decoded from sRGB), or null without
 * one; valid until the next call. */
EXPORT(extracted_color) const float *extracted_color(const char *name)
{
  static Array<ColorGeometry4f> colors;
  const Mesh &mesh = *extracted_mesh;
  const StringRef attribute = name ? StringRef(name) : StringRef(mesh.active_color_attribute ? mesh.active_color_attribute : "");
  const VArray<ColorGeometry4f> values = *mesh.attributes().lookup<ColorGeometry4f>(attribute, bke::AttrDomain::Corner);
  if (attribute.is_empty() || !values) {
    return nullptr;
  }
  colors.reinitialize(values.size());
  values.materialize(colors);
  return &colors.data()->r;
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
    /* The file's drivers and registered texts in Python (python.cc starts it first where scripts may run). */
    BPY_python_reset(ctx->C);
    file_read_notify(ctx);
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

/* A node tree as JSON: each node's idname and name with its inputs' identifiers and values (numbers, or null), and the
 * links (from node, from socket, to node, to socket), until the next call. */
static const char *describe(const bNodeTree &ntree)
{
  static std::string text;
  text = "{\"nodes\":[";
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

/* An ID's node tree as JSON (describe). */
EXPORT(node_tree_describe) const char *node_tree_describe(ID *owner) { return describe(tree_of(owner)); }

/* An ID's shader node tree as EEVEE compiles it (GPU_material_from_nodetree): a new tree outside Main with its node
 * groups, closures and bundles inlined and its repeat zones kept (unrolled only where they hold closures or bundles),
 * for the EEVEE output; the caller frees it (node_tree_inlined_free). What inlining reported, a line per node, stays
 * until the next call (node_tree_inlined_errors). */
static std::string inline_errors;
EXPORT(node_tree_inlined) bNodeTree *node_tree_inlined(ID *owner)
{
  const bNodeTree &ntree = tree_of(owner);
  bNodeTree *inlined = bke::node_tree_add_tree(nullptr, (StringRef(ntree.id.name + 2) + " Inlined").c_str(), ntree.idname);
  inlined->flag |= NTREE_IS_GPU_SHADER_INTERNAL;
  nodes::InlineShaderNodeTreeParams params;
  params.allow_preserving_repeat_zones = true;
  params.target_engine_ = SHD_OUTPUT_EEVEE;
  nodes::inline_shader_node_tree(ntree, *inlined, params);
  inline_errors.clear();
  for (const nodes::InlineShaderNodeTreeParams::ErrorMessage &error : params.r_error_messages) {
    inline_errors += std::string(error.node ? error.node->name : "") + ": " + error.message + "\n";
  }
  return inlined;
}
EXPORT(node_tree_inlined_errors) const char *node_tree_inlined_errors() { return inline_errors.c_str(); }
EXPORT(node_tree_inlined_describe) const char *node_tree_inlined_describe(const bNodeTree *tree) { return describe(*tree); }
EXPORT(node_tree_inlined_free) void node_tree_inlined_free(bNodeTree *tree) { BKE_id_free(nullptr, &tree->id); }

/* port-override: the bundled startup file wm_files.cc reads a factory startup from; the module saves files and reads
 * none (Bylonder's scene is its own startup). */
extern "C" int datatoc_startup_blend_size = 0;
extern "C" const char datatoc_startup_blend[] = {0};

/* What the operators reach of Blender beyond the module. */

namespace blender {

/* As wm_window.cc defines it for the one window, whose screen has no 3D View of the module's to sync. */
void WM_windows_scene_data_sync(const ListBaseT<wmWindow> * /*win_lb*/, Scene * /*scene*/) {}

/* port-override: the module has no zlib (its calls would not link), so a gzip-compressed file is one it cannot
 * read, as when zlib reports an error; it reads no files anyway. */
FileReader *BLI_filereader_new_gzip(FileReader * /*base*/) { return nullptr; }

/* port-override: the module has no GPU materials, so a material's list of them is empty. */
void GPU_material_free(ListBaseT<LinkData> * /*gpumaterial*/) {}

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
