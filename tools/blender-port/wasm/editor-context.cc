/* Blender's operators without its window manager: registered by their own registration functions and run by their
 * own invoke, modal and exec on a context (Main's, main-api.cc), the 3D View they act in, and the stand-ins they read
 * of what the window manager and screen would give. */
#include "BLI_listbase.h"
#include "BLI_map.hh"
#include "BLI_set.hh"
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
#include "ED_node_c.hh"
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
#include "wm_event_system.hh"
#include "wm_gizmo_intern.hh"
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

/* port-override: the 3D View the editor shows (ED_view3d_update_viewmat with Babylon's camera as its matrices): its view
 * and window matrices (Blender's axes, column-major), its size in pixels and whether it is a perspective view. Operators
 * then act in it as in Blender's window region, projecting the mouse as it does. */
/* The window matrix and size each view was last given, which view3d_matrices_restore gives back after Blender's code
 * set up a view of its own (view3d_gpu_select_ex picking in a rectangle, gpu-select.cc). */
struct GivenView {
  float4x4 winmat;
  int winx, winy;
  bool is_persp;
};
static Map<const RegionView3D *, GivenView> &given_views()
{
  static Map<const RegionView3D *, GivenView> views;
  return views;
}
void view3d_matrices_set(RegionView3D &rv3d, const float *viewmat, const float *winmat, int winx, int winy, bool is_persp)
{
  given_views().add_overwrite(&rv3d, {float4x4(winmat), winx, winy, is_persp});
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
}
/* What Blender's view navigation keeps besides the matrices (ofs, dist; ED_view3d_from_object and the view operators
 * read them), whether the page shows the view through the scene camera (RV3D_CAMOB), and the camera a 3D View locked
 * to its scene shows (BKE_screen_view3d_sync), so that operators on the view's camera find it. */
void view3d_navigation_set(View3D &v3d, RegionView3D &rv3d, Scene *scene, const float *ofs, float dist, bool camera_view)
{
  copy_v3_v3(rv3d.ofs, ofs);
  rv3d.dist = dist;
  if (camera_view) {
    rv3d.persp = RV3D_CAMOB;
  }
  if (scene) {
    BKE_screen_view3d_sync(&v3d, scene);
  }
}
void view3d_matrices_restore(RegionView3D &rv3d)
{
  if (const GivenView *given = given_views().lookup_ptr(&rv3d)) {
    const GivenView view = *given;
    view3d_matrices_set(rv3d, &rv3d.viewmat[0][0], view.winmat.base_ptr(), view.winx, view.winy, view.is_persp);
  }
}
static wmGizmoMap *gizmo_map_standin();
/* A 3D View's window region given its view (main_view_set): area, space and region linked
 * once, the region's view set each time. */
void view3d_region_set(ScrArea &area, View3D &v3d, ARegion &region, RegionView3D &rv3d, const float *viewmat, const float *winmat, int winx,
                       int winy, bool is_persp)
{
  view3d_matrices_set(rv3d, viewmat, winmat, winx, winy, is_persp);
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

/* An empty map, so that Blender's code reading it (the window's event handling, wm_event_system.cc) finds no groups. */
static wmGizmoMap *gizmo_map_standin()
{
  static wmGizmoMap standin = {};
  return &standin;
}

namespace blender {

bContext *wm_handling_context();

/* The preselection gizmos (view3d_gizmo_preselect_type.cc), Blender's own, in a group of their own. */
static wmGizmo *preselect_gizmo(const char *group, const char *type)
{
  static Map<std::string, wmGizmoGroup *> groups;
  wmGizmoGroup *gzgroup = groups.lookup_or_add_cb(group, [&]() {
    wmGizmoGroup *made = MEM_new_zeroed<wmGizmoGroup>(__func__);
    made->type = WM_gizmogrouptype_find(group, true);
    WM_gizmo_new_ptr(WM_gizmotype_find(type, false), made, nullptr);
    return made;
  });
  return static_cast<wmGizmo *>(gzgroup->gizmos.first);
}

/* port-override: the gizmos are Bylonder's (wm-gizmo-map.js), but for the preselection ones tools read (Loop Cut's
 * edge ring, Poly Build's element): the element under the mouse, picked by the gizmo's own test_select in the window
 * region of the event the window handles. */
wmGizmoGroup *WM_gizmomap_group_find(wmGizmoMap * /*gzmap*/, const char *idname)
{
  const char *type = STREQ(idname, "VIEW3D_GGT_mesh_preselect_edgering") ? "GIZMO_GT_mesh_preselect_edgering_3d" :
                     STREQ(idname, "VIEW3D_GGT_mesh_preselect_elem")     ? "GIZMO_GT_mesh_preselect_elem_3d" :
                                                                            nullptr;
  bContext *C = wm_handling_context();
  const ARegion *region = C ? CTX_wm_region(C) : nullptr;
  if (!type || !region || region->regiontype != RGN_TYPE_WINDOW || !CTX_data_edit_object(C)) {
    return nullptr;
  }
  wmGizmo *gz = preselect_gizmo(idname, type);
  const int *xy = CTX_wm_window(C)->runtime->eventstate->xy;
  const int mval[2] = {xy[0] - region->winrct.xmin, xy[1] - region->winrct.ymin};
  gz->type->test_select(C, gz, mval);
  return gz->parent_gzgroup;
}
bool WM_gizmo_context_check_drawstep(const bContext * /*C*/, eWM_GizmoFlagMapDrawStep /*step*/) { return true; }
/* No gizmo runs modally in the module, and none of its groups is listed: the gizmos are Bylonder's. */
wmGizmo *WM_gizmomap_get_modal(const wmGizmoMap * /*gzmap*/) { return nullptr; }
const ListBaseT<wmGizmoGroup> *WM_gizmomap_group_list(wmGizmoMap * /*gzmap*/)
{
  static ListBaseT<wmGizmoGroup> none = {};
  return &none;
}

/* port-override: gizmo group types by name only, so an operator's request for one reaches JS, which draws it, with
 * the flag of those whose tools drag with the fallback tool off the gizmo (the tool system keeps its keymap). */
wmGizmoGroupType *WM_gizmogrouptype_find(StringRef idname, bool /*quiet*/)
{
  static const Set<StringRef> fallback_keymap = {"VIEW3D_GGT_xform_gizmo",
                                                 "VIEW3D_GGT_xform_gizmo_context",
                                                 "VIEW3D_GGT_xform_cage",
                                                 "VIEW3D_GGT_xform_shear",
                                                 "VIEW3D_GGT_xform_extrude",
                                                 "MESH_GGT_spin",
                                                 "MESH_GGT_spin_redo",
                                                 "VIEW3D_GGT_mesh_preselect_elem",
                                                 "VIEW3D_GGT_mesh_preselect_edgering",
                                                 "VIEW3D_GGT_tool_generic_handle_normal",
                                                 "VIEW3D_GGT_tool_generic_handle_free"};
  static Map<std::string, std::unique_ptr<wmGizmoGroupType>> types;
  return types.lookup_or_add_cb(idname, [&]() {
    auto type = std::make_unique<wmGizmoGroupType>();
    type->idname = BLI_strdupn(idname.data(), idname.size());
    if (fallback_keymap.contains(idname)) {
      type->flag |= WM_GIZMOGROUPTYPE_TOOL_FALLBACK_KEYMAP;
    }
    return type;
  }).get();
}
bool WM_gizmo_group_type_ensure_ptr(wmGizmoGroupType * /*gzgt*/) { return true; }
bool WM_gizmo_group_type_ensure(StringRef idname) { return WM_gizmo_group_type_ensure_ptr(WM_gizmogrouptype_find(idname, true)); }
void WM_gizmo_group_type_reinit_ptr(Main * /*bmain*/, wmGizmoGroupType *gzgt) { WM_gizmo_group_type_ensure_ptr(gzgt); }


}  // namespace blender

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
  /* As WM_init registers them: the window manager's, every space's with their operators and gizmos (and the node
   * types' draw functions), then macros. */
  static Vector<wmOperatorType *> table = [] {
    wm_operatortypes_register();
    ED_spacetypes_init();
    ED_node_init_butfuncs();
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
EXPORT(operator_free) void operator_free(wmOperator *op) { WM_operator_free(op); }

/* Sets a property: numbers (len of them), or a string or enum identifiers. */
EXPORT(operator_set) bool operator_set(wmOperator *op, const char *name, const double *numbers, int len, const char *text)
{
  const bool set = operator_property_set(op->ptr, name, numbers, len, text);
  if (set && strchr(name, '.')) {
    operator_macro_fill(op);
  }
  return set;
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
  /* So the items function gets the context, as the UI's operator enum menus do (uiItemsFullEnumO): an owner ID
   * (WM_operator_properties_create_ptr's window manager, the context's here) and no PROP_ENUM_NO_CONTEXT. */
  wmWindowManager *wm = CTX_wm_manager(C);
  op->ptr->owner_id = wm ? &wm->id : &CTX_data_scene(C)->id;
  WM_operator_properties_sanitize(op->ptr, false);
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
  WM_operator_free(op);
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

/* The operator the last invoke added a modal handler for (WM_event_add_modal_handler), or null: its handler leaves the
 * window, as JS gives it its events (operator_modal). */
EXPORT(operator_modal_added) wmOperator *operator_modal_added(bContext *C)
{
  wmWindow *win = CTX_wm_window(C);
  for (wmEventHandler &handler : win->runtime->modalhandlers) {
    if (handler.type == WM_HANDLER_TYPE_OP) {
      wmOperator *op = reinterpret_cast<wmEventHandler_Op *>(&handler)->op;
      WM_event_remove_modal_handler(&win->runtime->modalhandlers, op, false);
      return op;
    }
  }
  return nullptr;
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
  if (items) {
    keymap->modal_items = items;
  }
  return keymap;
}
void WM_modalkeymap_assign(wmKeyMap *km, const char *opname)
{
  if (wmOperatorType *ot = WM_operatortype_find(opname, true)) {
    ot->modalkeymap = km;
  }
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

/* Marks the properties after it as advanced in Blender's UI. */
void WM_operatortype_props_advanced_begin(wmOperatorType * /*ot*/) {}

/* No window or view to update. */
void ED_workspace_status_text(bContext * /*C*/, const char * /*str*/) {}

}  // namespace blender
