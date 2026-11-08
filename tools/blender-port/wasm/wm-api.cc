/* Blender's window manager over the browser. Main's window manager has one window, a GHOST window of the browser
 * (ghost-window.cc), whose screen holds areas made by their space types as Blender makes them. The browser lays the
 * areas out (CSS) and gives their rectangles here, one way; it turns its input into GHOST events, which Blender's own
 * event system handles (wm_event_add_ghostevent, wm_event_do_handlers, wm_event_do_notifiers): the keymaps of the
 * window, areas and regions, modal operators, macros and gestures run as in Blender. Each event returns what Blender
 * tagged for redrawing. */
#include "BKE_addon.h"
#include "BKE_camera.h"
#include "BKE_context.hh"
#include "BKE_keyconfig.h"
#include "BKE_global.hh"
#include "BKE_lib_remap.hh"
#include "BKE_main.hh"
#include "BKE_screen.hh"
#include "BLI_listbase.h"
#include "BLI_map.hh"
#include "BLI_math_matrix.h"
#include "BLI_math_rotation.h"
#include "BLI_math_vector.h"
#include "BLI_rect.h"
#include "BLI_set.hh"
#include "BLI_string.h"
#include "BLI_function_ref.hh"
#include "BLI_time.h"
#include "BLI_vector.hh"
#include "DNA_camera_types.h"
#include "DNA_screen_types.h"
#include "DNA_space_types.h"
#include "DNA_userdef_types.h"
#include "DNA_view3d_types.h"
#include "DNA_windowmanager_types.h"
#include "ED_screen.hh"
#include "ED_view3d.hh"
#include "ED_space_api.hh"
#include "ED_util.hh"
#include "MEM_guardedalloc.h"
#include "RNA_access.hh"
#include "UI_resources.hh"
#include "RNA_enum_types.hh"
#include "RNA_prototypes.hh"
#include "WM_api.hh"
#include "WM_keymap.hh"
#include "WM_message.hh"
#include "WM_types.hh"
#include "wm.hh"
#include "wm_event_system.hh"
#include "wm_window.hh"

#include "GHOST_IWindow.hh"

#include "area.hh"
#include "rna-runtime.hh"
#include "rna_internal_types.hh"

#include <algorithm>
#include <string>

#define EXPORT(name) extern "C" __attribute__((export_name(#name)))

GHOST_IWindow *ghost_window_new(uint32_t width, uint32_t height);
extern "C" void region_draw_begin(int winx, int winy);
extern "C" const char *region_draw_end();
extern "C" void region_draw_free(const blender::bContext *C, blender::ARegion *region);
GHOST_TKey ghost_key_from_browser(const char *code, const char *key);
/* The page loads Blender's key configuration again (bpy.utils.keyconfig_init, through its preset's load). */
extern "C" __attribute__((import_module("env"), import_name("wm_keyconfig_reload"))) void wm_keyconfig_reload(blender::bContext *C);
void view3d_navigation_set(blender::View3D &v3d, blender::RegionView3D &rv3d, blender::Scene *scene, const float *ofs, float dist, bool camera_view);
void view3d_matrices_set(blender::RegionView3D &rv3d, const float *viewmat, const float *winmat, int winx, int winy, bool is_persp);

namespace blender {

std::string operator_popup_json();
bool area_regions_poll(bContext *C, const bScreen *screen, ScrArea *area);
namespace ed::asset::shelf {
int region_prefsizey();
int header_region_size();
}  // namespace ed::asset::shelf
void screen_area_spacelink_add(const Scene *scene, ScrArea *area, eSpace_Type space_type);
ScrVert *screen_geom_vertex_add(bScreen *screen, short x, short y);

/* IDs Blender's code removes or remaps are remapped in the editors (WM_main_remap_editor_id_reference, through each
 * space type's id_remap), Main's screens' and the window's, which is outside Main. */
static void editor_id_remap(const bke::id::IDRemapper &mappings)
{
  WM_main_remap_editor_id_reference(mappings);
  for (wmWindow &win : static_cast<wmWindowManager *>(G_MAIN->wm.first)->windows) {
    for (ScrArea &area : WM_window_get_active_screen(&win)->areabase) {
      for (SpaceLink &sl : area.spacedata) {
        ED_spacedata_id_remap(&area, &sl, mappings);
      }
    }
  }
}

/* The window manager as WM_init sets it up for its window: its key configurations, empty until Python's keyconfig
 * (wm_keyconfig_init), and the window's GHOST window. */
/* port-override: rna_userdef_keyconfig_reload_update takes (C, bmain, scene, ptr) but RNA calls a context update as
 * (C, ptr), which WebAssembly's typed indirect calls trap on; this one has the context update's type. WM_keyconfig_reload
 * runs Python's keyconfig_init, which the page's Python does. */
void rna_userdef_is_dirty_update_impl();
static void keyconfig_reload_update(bContext *C, PointerRNA * /*ptr*/)
{
  wm_keyconfig_reload(C);
  rna_userdef_is_dirty_update_impl();
}

static void keyconfig_reload_updates_set()
{
  for (const char *name : {"use_mouse_emulate_3_button", "mouse_emulate_3_button_modifier"}) {
    PropertyRNA *prop = RNA_struct_type_find_property(RNA_PreferencesInput, name);
    prop->update = reinterpret_cast<UpdateFunc>(reinterpret_cast<void *>(keyconfig_reload_update));
  }
}

/* port-override: the page draws the window, so it is never made drawable again, which is where Blender sets the
 * window's resolution from the Preferences (WM_window_dpi_set_userdef); reading the Preferences clears the drawable to
 * ask for that, so it is set here. */
void wm_window_clear_drawable(wmWindowManager *wm)
{
  wm->runtime->windrawable = nullptr;
  for (wmWindow &win : wm->windows) {
    if (win.runtime->ghostwin) {
      WM_window_dpi_set_userdef(&win);
    }
  }
}

void wm_init(bContext *C)
{
  wmWindowManager *wm = CTX_wm_manager(C);
  /* As WM_init: the registries of add-ons' and key configurations' preferences types. */
  BKE_addon_pref_type_init();
  BKE_keyconfig_pref_type_init();
  keyconfig_reload_updates_set();
  wm->runtime->defaultconf = WM_keyconfig_new(wm, WM_KEYCONFIG_STR_DEFAULT, false);
  wm->runtime->addonconf = WM_keyconfig_new(wm, WM_KEYCONFIG_STR_DEFAULT " addon", false);
  wm->runtime->userconf = WM_keyconfig_new(wm, WM_KEYCONFIG_STR_DEFAULT " user", false);
  /* As WM_init and WM_check: the message bus Python's bpy.msgbus subscribes to (an add-on's, the pose library's). */
  static const bool msgbus_types = (WM_msgbus_types_init(), true);
  (void)msgbus_types;
  wm->runtime->message_bus = WM_msgbus_create();
  BKE_library_callback_remap_editor_id_reference_set(editor_id_remap);
  BKE_library_callback_free_notifier_reference_set(WM_main_remove_notifier_reference);
  CTX_wm_window(C)->runtime->ghostwin = ghost_window_new(1, 1);
}

/* As WM_keyconfig_init does once Python is initialized (its operators registered, which drop boxes name): the keymaps
 * and drop boxes Blender's C defines (wm_window_keymap, ED_spacetypes_keymap), then, as wm_window_ghostwindows_ensure
 * adds them, the window's handlers. Python's keyconfig data then fills the keymaps (bl_keymap_utils.io). */
EXPORT(wm_keyconfig_init) void wm_keyconfig_init(bContext *C)
{
  wmWindowManager *wm = CTX_wm_manager(C);
  if (wm->runtime->defaultconf->flag & KEYCONF_INIT_DEFAULT) {
    return;
  }
  wm_window_keymap(wm->runtime->defaultconf);
  ED_spacetypes_keymap(wm->runtime->defaultconf);
  wm->runtime->defaultconf->flag |= KEYCONF_INIT_DEFAULT;
  wmWindow *win = CTX_wm_window(C);
  wmKeyMap *keymap = WM_keymap_ensure(wm->runtime->defaultconf, "Window", SPACE_EMPTY, RGN_TYPE_WINDOW);
  WM_event_add_keymap_handler(&win->runtime->handlers, keymap);
  keymap = WM_keymap_ensure(wm->runtime->defaultconf, "Screen", SPACE_EMPTY, RGN_TYPE_WINDOW);
  WM_event_add_keymap_handler(&win->runtime->handlers, keymap);
  keymap = WM_keymap_ensure(wm->runtime->defaultconf, "Screen Editing", SPACE_EMPTY, RGN_TYPE_WINDOW);
  WM_event_add_keymap_handler(&win->runtime->modalhandlers, keymap);
  WM_event_add_dropbox_handler(&win->runtime->handlers, WM_dropboxmap_find("Window", SPACE_EMPTY, RGN_TYPE_WINDOW));
}

/* Keyconfig data is loaded by Blender's Python (bl_keymap_utils.io, through rna-bridge.cc). */
/* After loading: the user key configuration is made from the default one before the next event (WM_keyconfig_update). */
EXPORT(wm_keyconfig_loaded) void wm_keyconfig_loaded() { WM_keyconfig_update_tag(nullptr, nullptr); }
/* The user key configuration made now (as before the next event), for the page's keymaps to read. */
EXPORT(wm_keyconfig_update) void wm_keyconfig_update(bContext *C) { WM_keyconfig_update(CTX_wm_manager(C)); }

/* The window's size in pixels (the page's), which flips the browser's y down into Blender's y up. */
EXPORT(wm_window_size_set) void wm_window_size_set(bContext *C, int width, int height)
{
  wmWindow *win = CTX_wm_window(C);
  win->sizex = short(width);
  win->sizey = short(height);
}

/* An area of a space type (SPACE_VIEW3D, ...) in the window's screen, as ED_area_newspace makes one: the space its
 * type creates for the sub-type asked for (Area.ui_type within the space: a SpaceAction's mode; -1 for its default),
 * holding the space's regions. */
EXPORT(wm_area_new) ScrArea *wm_area_new(bContext *C, int spacetype, int subtype)
{
  wmWindow *win = CTX_wm_window(C);
  bScreen *screen = WM_window_get_active_screen(win);
  ScrArea *area = &MEM_new<BylonderArea>(__func__)->area;
  area->v1 = screen_geom_vertex_add(screen, 0, 0);
  area->v2 = screen_geom_vertex_add(screen, 0, 1);
  area->v3 = screen_geom_vertex_add(screen, 1, 1);
  area->v4 = screen_geom_vertex_add(screen, 1, 0);
  area->spacetype = char(spacetype);
  area->butspacetype_subtype = short(std::max(subtype, 0));
  screen_area_spacelink_add(WM_window_get_active_scene(win), area, eSpace_Type(spacetype));
  ED_area_and_region_types_init(area);
  if (area->type->space_subtype_set && subtype >= 0) {
    area->type->space_subtype_set(area, subtype);
  }
  BLI_addtail(&screen->areabase, area);
  return area;
}

/* What an operator shows in the area's header (ED_area_status_text), or ''. */
EXPORT(wm_area_status) const char *wm_area_status(ScrArea *area) { return reinterpret_cast<BylonderArea *>(area)->status.c_str(); }

EXPORT(wm_area_free) void wm_area_free(bContext *C, ScrArea *area)
{
  wmWindow *win = CTX_wm_window(C);
  bScreen *screen = WM_window_get_active_screen(win);
  for (ARegion &region : area->regionbase) {
    region_draw_free(C, &region);
  }
  ED_area_exit(C, area);
  BLI_remlink(&screen->areabase, area);
  BKE_screen_area_free(area);
  /* Its own vertices only: the page's areas have no edges, so BKE_screen_remove_unused_scrverts would free all theirs. */
  for (ScrVert *vertex : {area->v1, area->v2, area->v3, area->v4}) {
    BLI_remlink(&screen->vertbase, vertex);
    MEM_delete(vertex);
  }
  MEM_delete(reinterpret_cast<BylonderArea *>(area));
}

/* A rectangle of the page (pixels from its top left) in Blender's window coordinates (from its bottom left). */
static rcti window_rect(const wmWindow *win, const int *rect)
{
  const int x = rect[0], y = win->sizey - rect[1] - rect[3];
  return rcti{x, x + rect[2] - 1, y, y + rect[3] - 1};
}

/* An area's place and its regions' as the page lays them out: (regiontype, x, y, width, height) for the area (-1)
 * and each region it shows, in page pixels; the regions it does not list are hidden, but for those Blender shows itself
 * (wm_area_regions_shown), which it lists as Blender shows them. The first layout initializes
 * the area as ED_area_init does (its handlers and keymaps, its regions' types); every layout runs the regions' init
 * as Blender does after a resize (ED_area_update_region_sizes). */
EXPORT(wm_area_layout) void wm_area_layout(bContext *C, ScrArea *area, const int *rects, int count)
{
  wmWindowManager *wm = CTX_wm_manager(C);
  wmWindow *win = CTX_wm_window(C);
  const rcti total = window_rect(win, rects + 1);
  area->v1->vec = {short(total.xmin), short(total.ymin)};
  area->v2->vec = {short(total.xmin), short(total.ymax)};
  area->v3->vec = {short(total.xmax), short(total.ymax)};
  area->v4->vec = {short(total.xmax), short(total.ymin)};
  if (!std::exchange(reinterpret_cast<BylonderArea *>(area)->initialized, true)) {
    ED_area_init(C, win, area);
  }
  area->totrct = total;
  area->winx = short(BLI_rcti_size_x(&total) + 1);
  area->winy = short(BLI_rcti_size_y(&total) + 1);
  const Set<int> &polled = reinterpret_cast<BylonderArea *>(area)->polled;
  for (ARegion &region : area->regionbase) {
    const int *shown = nullptr;
    for (int i = 1; i < count; i++) {
      if (rects[i * 5] == region.regiontype) {
        shown = rects + i * 5 + 1;
      }
    }
    if (!polled.contains(region.regiontype)) {
      SET_FLAG_FROM_TEST(region.flag, !shown, RGN_FLAG_HIDDEN);
    }
    region.runtime->visible = shown != nullptr;
    if (!shown) {
      /* As region_rect_recursive leaves a hidden region: no rectangle, so no event finds it. */
      BLI_rcti_init(&region.winrct, 0, 0, 0, 0);
      continue;
    }
    region.winrct = window_rect(win, shown);
    ED_region_update_rect(&region);
    if (region.runtime->type->init) {
      region.runtime->type->init(wm, &region);
    }
  }
}

/* blender-port: area.cc region_rect_recursive, the preferred height of a region in pixels. */
static int region_height(const ARegion &region)
{
  switch (region.regiontype) {
    case RGN_TYPE_ASSET_SHELF:
      return region.sizey > 1 ? int(UI_SCALE_FAC * (region.sizey + 0.5f)) : ed::asset::shelf::region_prefsizey();
    case RGN_TYPE_ASSET_SHELF_HEADER:
      return ed::asset::shelf::header_region_size();
    default:
      return int(UI_SCALE_FAC * (region.sizey > 1 ? region.sizey + 0.5f : region.runtime->type->prefsizey));
  }
}

/* Regions Blender shows itself, by their types' polls and their flags (area_regions_poll, as a screen refresh runs it:
 * the asset shelf, by its shelf types' polls and its View > Asset Shelf toggle), of the `types` given, which the page
 * lays out from now on as Blender shows them. Returns JSON { regiontype: height in pixels } of those shown; a region
 * that hides with the one before it (the asset shelf's header, which Blender never hides itself) is shown with it. */
EXPORT(wm_area_regions_shown) const char *wm_area_regions_shown(bContext *C, ScrArea *area, const int *types, int count)
{
  static std::string json;
  Set<int> &polled = reinterpret_cast<BylonderArea *>(area)->polled;
  polled.add_multiple(Span<int>(types, count));
  area_regions_poll(C, WM_window_get_active_screen(CTX_wm_window(C)), area);
  json = "{";
  bool previous_shown = false;
  for (const ARegion &region : area->regionbase) {
    const bool shown = !(region.flag & RGN_FLAG_POLL_FAILED) && ((region.alignment & RGN_ALIGN_HIDE_WITH_PREV) ?
                                                                    previous_shown :
                                                                    !(region.flag & RGN_FLAG_HIDDEN));
    if (shown && polled.contains(region.regiontype)) {
      json += (json.size() > 1 ? ",\"" : "\"") + std::to_string(region.regiontype) + "\":" + std::to_string(region_height(region));
    }
    previous_shown = shown;
  }
  json += "}";
  return json.c_str();
}

/* A 3D View's view as the page's camera has it (port-override: Bylonder navigates the view, ED_view3d_update_viewmat
 * with Babylon's camera as its matrices): view and window matrices (Blender's axes, column-major) and whether it is a
 * perspective view, for its window region. */
EXPORT(wm_view3d_set)
void wm_view3d_set(bContext *C, ScrArea *area, const float *viewmat, const float *winmat, bool is_persp, const float *ofs, float dist, bool camera_view)
{
  ARegion *region = BKE_area_find_region_type(area, RGN_TYPE_WINDOW);
  RegionView3D &rv3d = *static_cast<RegionView3D *>(region->regiondata);
  view3d_matrices_set(rv3d, viewmat, winmat, region->winx, region->winy, is_persp);
  view3d_navigation_set(*static_cast<View3D *>(area->spacedata.first), rv3d, WM_window_get_active_scene(CTX_wm_window(C)), ofs, dist, camera_view);
}
/* The 3D View as Blender's navigation left it, for the page's camera to follow: its offset (3), view rotation (4) and
 * distance, its projection (RV3D_ORTHO, RV3D_PERSP or RV3D_CAMOB) and its axis view (RV3D_VIEW_*). */
EXPORT(wm_view3d_get) void wm_view3d_get(ScrArea *area, float *out)
{
  ARegion *region = BKE_area_find_region_type(area, RGN_TYPE_WINDOW);
  const RegionView3D &rv3d = *static_cast<const RegionView3D *>(region->regiondata);
  copy_v3_v3(out, rv3d.ofs);
  copy_v4_v4(out + 3, rv3d.viewquat);
  out[7] = rv3d.dist;
  out[8] = rv3d.persp;
  out[9] = rv3d.view;
}

/* Camera view in a 3D View's window region as Blender draws it, at the view's camera zoom and offset (view3d.zoom,
 * view3d.view_center_camera): the region's view plane (BKE_camera_params_from_view3d) as camera_view_fov gives a
 * camera's (field of view along the fitted side, whether that is the height, the plane's center as a part of its half
 * width and height), the plane's half width and height (scene units for an orthographic camera), and the camera's
 * frame in the region (ED_view3d_calc_camera_border) as xmin, ymin, xmax, ymax in pixels from its bottom left. */
EXPORT(wm_view3d_camera) const float *wm_view3d_camera(bContext *C, ScrArea *area)
{
  static float result[10];
  const ARegion *region = BKE_area_find_region_type(area, RGN_TYPE_WINDOW);
  const View3D *v3d = static_cast<const View3D *>(area->spacedata.first);
  const RegionView3D *rv3d = static_cast<const RegionView3D *>(region->regiondata);
  const Scene *scene = WM_window_get_active_scene(CTX_wm_window(C));
  const Depsgraph *depsgraph = CTX_data_depsgraph_pointer(C);
  CameraParams params;
  BKE_camera_params_init(&params);
  BKE_camera_params_from_view3d(&params, depsgraph, v3d, rv3d);
  BKE_camera_params_compute_viewplane(&params, region->winx, region->winy, 1.0f, 1.0f);
  const rctf &plane = params.viewplane;
  const bool vertical = BKE_camera_sensor_fit(params.sensor_fit, region->winx, region->winy) == CAMERA_SENSOR_FIT_VERT;
  result[0] = 2.0f * atanf((vertical ? BLI_rctf_size_y(&plane) : BLI_rctf_size_x(&plane)) / 2.0f / params.clip_start);
  result[1] = vertical;
  result[2] = (plane.xmin + plane.xmax) / BLI_rctf_size_x(&plane);
  result[3] = (plane.ymin + plane.ymax) / BLI_rctf_size_y(&plane);
  result[4] = BLI_rctf_size_x(&plane) / 2.0f;
  result[5] = BLI_rctf_size_y(&plane) / 2.0f;
  rctf border;
  ED_view3d_calc_camera_border(scene, depsgraph, region, v3d, rv3d, false, &border);
  result[6] = border.xmin;
  result[7] = border.ymin;
  result[8] = border.xmax;
  result[9] = border.ymax;
  return result;
}

/* The browser's input as GHOST's events: the pointer's place (page pixels), a button pressed or released (the DOM's
 * button number, which is GHOST's), each with a pen's pressure and tilt, the wheel, a trackpad's scroll or zoom, a key
 * pressed (with its text) or released
 * (by the DOM's code and key). */
enum BrowserEvent {
  BROWSER_POINTER_MOVE,
  BROWSER_BUTTON_DOWN,
  BROWSER_BUTTON_UP,
  BROWSER_WHEEL,
  BROWSER_TRACKPAD,
  BROWSER_KEY_DOWN,
  BROWSER_KEY_UP,
};

/* A pen's state as GHOST gives it with a pointer event, from the page's: its mode (GHOST_TTabletMode: none, stylus or
 * eraser), pressure in thousandths (0 to 1000) and tilt in thousandths of the full lean (-1000 to 1000). */
static GHOST_TabletData tablet_data(const int *data)
{
  if (data[0] == GHOST_kTabletModeNone) {
    return GHOST_TABLET_DATA_NONE;
  }
  return {GHOST_TTabletMode(data[0]), data[1] / 1000.0f, data[2] / 1000.0f, data[3] / 1000.0f};
}

static void ghost_event_add(wmWindowManager *wm, wmWindow *win, int kind, const int *data, const char *code, const char *key,
                            const char *text, uint64_t time)
{
  switch (kind) {
    case BROWSER_POINTER_MOVE: {
      GHOST_TEventCursorData cursor = {data[0], data[1], tablet_data(data + 2)};
      wm_event_add_ghostevent(wm, win, GHOST_kEventCursorMove, &cursor, time);
      break;
    }
    case BROWSER_BUTTON_DOWN:
    case BROWSER_BUTTON_UP: {
      GHOST_TEventButtonData button = {GHOST_TButton(data[0]), tablet_data(data + 2)};
      wm_event_add_ghostevent(wm, win, kind == BROWSER_BUTTON_DOWN ? GHOST_kEventButtonDown : GHOST_kEventButtonUp, &button, time);
      break;
    }
    case BROWSER_WHEEL: {
      GHOST_TEventWheelData wheel = {GHOST_TEventWheelAxis(data[0]), data[1]};
      wm_event_add_ghostevent(wm, win, GHOST_kEventWheel, &wheel, time);
      break;
    }
    case BROWSER_TRACKPAD: {
      GHOST_TEventTrackpadData pad = {GHOST_TTrackpadEventSubTypes(data[0]), data[1], data[2], data[3], data[4], char(data[5])};
      wm_event_add_ghostevent(wm, win, GHOST_kEventTrackpad, &pad, time);
      break;
    }
    case BROWSER_KEY_DOWN:
    case BROWSER_KEY_UP: {
      GHOST_TEventKeyData keydata = {};
      keydata.key = ghost_key_from_browser(code, key);
      keydata.is_repeat = data[0] != 0;
      STRNCPY(keydata.utf8_buf, kind == BROWSER_KEY_DOWN ? text : "");
      wm_event_add_ghostevent(wm, win, kind == BROWSER_KEY_DOWN ? GHOST_kEventKeyDown : GHOST_kEventKeyUp, &keydata, time);
      break;
    }
  }
}

/* The events no handler of Blender's used, as they reach the end of the window's handlers (a UI handler there, which
 * passes them on): the page's own keymaps get them. */
static std::string unhandled_events;
static int unhandled_event(bContext * /*C*/, const wmEvent *event, void * /*user_data*/)
{
  if (event->type == EVENT_NONE || ISMOUSE_MOTION(event->type) || ISTIMER(event->type) || event->type == EVT_MODAL_MAP ||
      event->type >= EVT_FILESELECT)
  {
    return WM_UI_HANDLER_CONTINUE;
  }
  const wmWindow *win = static_cast<wmWindow *>(static_cast<wmWindowManager *>(G_MAIN->wm.first)->windows.first);
  const auto identifier = [](const EnumPropertyItem *items, int value) {
    const char *id = "";
    RNA_enum_identifier(items, value, &id);
    return std::string(id);
  };
  const auto page = [&](const int *xy) { return std::to_string(xy[0]) + "," + std::to_string(win->sizey - 1 - xy[1]); };
  unhandled_events += std::string(unhandled_events.empty() ? "" : ",") + "{\"type\":\"" +
                      identifier(rna_enum_event_type_items, event->type) + "\",\"value\":\"" +
                      identifier(rna_enum_event_value_items, event->val) + "\",\"modifier\":" + std::to_string(event->modifier) +
                      ",\"xy\":[" + page(event->xy) + "],\"press\":[" + page(event->prev_press_xy) + "],\"direction\":\"" +
                      (event->val == KM_PRESS_DRAG ? identifier(rna_enum_event_direction_items, WM_event_drag_direction(event)) : "") +
                      "\",\"repeat\":" + ((event->flag & WM_EVENT_IS_REPEAT) ? "true" : "false") + "}";
  return WM_UI_HANDLER_CONTINUE;
}
static void unhandled_handler_ensure(wmWindow *win)
{
  ListBaseT<wmEventHandler> &handlers = win->runtime->handlers;
  if (handlers.last && static_cast<wmEventHandler *>(handlers.last)->type == WM_HANDLER_TYPE_UI &&
      static_cast<wmEventHandler_UI *>(handlers.last)->handle_fn == unhandled_event)
  {
    return;
  }
  WM_event_add_ui_handler(nullptr, &handlers, unhandled_event, nullptr, nullptr, WM_HANDLER_ACCEPT_DBL_CLICK);
  BLI_addtail(&handlers, BLI_pophead(&handlers));
}

/* port-override: until Bylonder's own operators are Blender's operator types, an event runs only the operators the page
 * allows (wm_operators_allow, those whose Bylonder registration runs Blender's). A keymap item of an operator the page
 * runs itself handles its event as Blender's would, by passing it on to the page, whose keymaps run that operator
 * (unhandled_events). One of an operator neither runs passes its event on, as an operator with nothing to do passes it
 * through: the next of Blender's handlers may take it (a console's typed text after the User Interface keymap's E and
 * I). While the window handles an event, the types' invoke (or exec) are wrapped to do so. The wrapping lasts only that
 * long, so types registered or copied at any other time see their own functions. */
#define IMPORT(name) extern "C" __attribute__((import_module("env"), import_name(#name)))
IMPORT(wm_page_operator) bool wm_page_operator(const char *idname);
static wmOperatorStatus page_gated(bContext *C, const wmOperator *op, const wmEvent *event)
{
  char idname[OP_MAX_TYPENAME];
  WM_operator_py_idname(idname, op->type->idname);
  if (!wm_page_operator(idname)) {
    return OPERATOR_CANCELLED | OPERATOR_PASS_THROUGH;
  }
  unhandled_event(C, event, nullptr);
  return OPERATOR_CANCELLED;
}
static Set<const wmOperatorType *> &allowed_operators()
{
  static Set<const wmOperatorType *> allowed;
  return allowed;
}

bool js_extension(const ExtensionRNA &ext);

/* An operator is allowed (or CPython's: an add-on's, the console's), or a step of a macro that is (its steps are the
 * macro's). */
static bool operator_allowed(const wmOperator *op)
{
  for (; op; op = op->opm) {
    if (allowed_operators().contains(op->type) || (op->type->rna_ext.srna && !js_extension(op->type->rna_ext))) {
      return true;
    }
  }
  return false;
}

struct OperatorCalls {
  decltype(wmOperatorType::invoke) invoke;
  decltype(wmOperatorType::exec) exec;
  decltype(wmOperatorType::modal) modal;
};
static Map<wmOperatorType *, OperatorCalls> &operator_calls()
{
  static Map<wmOperatorType *, OperatorCalls> calls;
  return calls;
}
/* The operators the window finished that are not registered for redo but are undo steps, Blender's mark of an edit of
 * the data (console.execute, an add-on's): the page learns of them as of the registered ones (event_result). Steps
 * that edit no data (console.insert, a typed character) are left out. */
static Vector<std::pair<std::string, bool>> &finished_unregistered()
{
  static Vector<std::pair<std::string, bool>> finished;
  return finished;
}
/* The allowed operators running: what one runs (a script's bpy.ops in console.execute or text.run_script) is its own,
 * as in Blender. Raised only around a call, so it is back to zero after every return, whatever the status. */
static int allowed_running = 0;
template<typename Call> static wmOperatorStatus allowed_call(const wmOperator *op, Call call)
{
  allowed_running++;
  const wmOperatorStatus status = call();
  allowed_running--;
  if (!allowed_running && (status & OPERATOR_FINISHED) && !(op->type->flag & OPTYPE_REGISTER) &&
      (op->type->flag & (OPTYPE_UNDO | OPTYPE_UNDO_GROUPED)))
  {
    finished_unregistered().append({op->type->idname, true});
  }
  return status;
}
static wmOperatorStatus page_invoke(bContext *C, wmOperator *op, const wmEvent *event)
{
  if (!allowed_running && !operator_allowed(op)) {
    return page_gated(C, op, event);
  }
  return allowed_call(op, [&]() { return operator_calls().lookup(op->type).invoke(C, op, event); });
}
static wmOperatorStatus page_exec(bContext *C, wmOperator *op)
{
  if (!allowed_running && !operator_allowed(op)) {
    return page_gated(C, op, CTX_wm_window(C)->runtime->eventstate);
  }
  return allowed_call(op, [&]() { return operator_calls().lookup(op->type).exec(C, op); });
}
/* A modal operator runs on only once allowed: what its modal step runs is its own too. */
static wmOperatorStatus page_modal(bContext *C, wmOperator *op, const wmEvent *event)
{
  return allowed_call(op, [&]() { return operator_calls().lookup(op->type).modal(C, op, event); });
}
static void operator_calls_unwrap();
static bool handling = false;
/* Whether the page's window is handling an event (anim-api.cc's gestures are Blender's then). */
bool wm_window_handling() { return handling; }
/* Unwrapped first, in case an exception left the last event's wrapping in place. */
static void operator_calls_wrap()
{
  operator_calls_unwrap();
  handling = true;
  for (wmOperatorType *ot : WM_operatortypes_registered_get()) {
    operator_calls().add_new(ot, {ot->invoke, ot->exec, ot->modal});
    if (ot->invoke) {
      ot->invoke = page_invoke;
    }
    else if (ot->exec) {
      ot->exec = page_exec;
    }
    if (ot->modal) {
      ot->modal = page_modal;
    }
  }
}
static void operator_calls_unwrap()
{
  handling = false;
  for (auto [ot, calls] : operator_calls().items()) {
    ot->invoke = calls.invoke;
    ot->exec = calls.exec;
    ot->modal = calls.modal;
  }
  operator_calls().clear();
}

/* The operators an event may run, by Python idname, one per line. */
EXPORT(wm_operators_allow) void wm_operators_allow(const char *idnames)
{
  allowed_operators().clear();
  const std::string lines = idnames;
  for (size_t start = 0, end; start < lines.size(); start = end + 1) {
    end = std::min(lines.find('\n', start), lines.size());
    char idname_bl[OP_MAX_TYPENAME];
    WM_operator_bl_idname(idname_bl, lines.substr(start, end - start).c_str());
    if (wmOperatorType *ot = WM_operatortype_find(idname_bl, true)) {
      allowed_operators().add(ot);
    }
  }
}

/* A press of the page's own keymaps used (an unhandled one): no click or drag of it follows, as when a handler of
 * Blender's uses a press. */
EXPORT(wm_event_press_handled) void wm_event_press_handled(bContext *C)
{
  wmWindow *win = static_cast<wmWindow *>(CTX_wm_manager(C)->windows.first);
  win->event_queue_check_click = false;
  win->event_queue_check_drag = false;
}

/* What an event left to the page as JSON: the regions Blender tagged for redrawing ([area, regiontype] pairs, their
 * tags cleared as drawing clears them), whether an operator runs modally (the page then keeps the pointer), the
 * operators that finished (idname and whether a run is an undo step), the popup or menu an
 * operator opened, and the unhandled events. */
static const char *event_result(wmWindow *win, const Set<wmOperator *> &registered)
{
  static std::string json;
  json = "{\"redraw\":[";
  bool first = true;
  ED_screen_areas_iter (win, WM_window_get_active_screen(win), area) {
    for (ARegion &region : area->regionbase) {
      if (region.runtime->do_draw & (RGN_DRAW | RGN_DRAW_PARTIAL | RGN_DRAW_NO_REBUILD | RGN_DRAW_EDITOR_OVERLAYS)) {
        json += (first ? "[" : ",[") + std::to_string(uintptr_t(area)) + "," + std::to_string(region.regiontype) + "]";
        first = false;
        region.runtime->do_draw = 0;
      }
    }
  }
  bool modal = false;
  for (wmEventHandler &handler : win->runtime->modalhandlers) {
    modal |= handler.type == WM_HANDLER_TYPE_OP;
  }
  json += "],\"modal\":" + std::string(modal ? "true" : "false") + ",\"finished\":[";
  wmWindowManager *wm = static_cast<wmWindowManager *>(G_MAIN->wm.first);
  const auto finished = [&](const char *idname, bool undo) {
    json += std::string(json.back() == '[' ? "" : ",") + "{\"idname\":\"" + idname + "\",\"undo\":" + (undo ? "true" : "false") + "}";
  };
  for (wmOperator &op : wm->runtime->operators) {
    if (!registered.contains(&op)) {
      finished(op.type->idname, op.type->flag & (OPTYPE_UNDO | OPTYPE_UNDO_GROUPED));
    }
  }
  for (const auto &[idname, undo] : finished_unregistered()) {
    finished(idname.c_str(), undo);
  }
  json += "],\"popup\":" + operator_popup_json() + ",\"unhandled\":[" + unhandled_events + "]}";
  return json.c_str();
}

/* port-override: wm_window_timers_process (wm_window.cc) for the page's window, which has no GHOST loop to run it: the
 * window timers that are due become TIMER events in its queue (panel animations, tooltips, modal operators' timers),
 * notifier timers add their notifiers and job timers update their jobs, as Blender's do whatever their window. Autosave has
 * no timer here. */
static void wm_window_timers_process(wmWindowManager *wm)
{
  const double time = BLI_time_now_seconds();
  for (wmTimer &wt : wm->runtime->timers.items_mutable()) {
    if ((wt.flags & WM_TIMER_TAGGED_FOR_REMOVAL) || wt.sleep || wt.time_next >= time) {
      continue;
    }
    if (!ELEM(wt.event_type, TIMERNOTIFIER, TIMERJOBS) && BLI_findindex(&wm->windows, wt.win) == -1) {
      continue;
    }
    wt.time_delta = time - wt.time_last;
    wt.time_duration += wt.time_delta;
    wt.time_last = time;
    wt.time_next = wt.time_start;
    if (wt.time_step != 0.0f) {
      wt.time_next += wt.time_step * ceil(wt.time_duration / wt.time_step);
    }
    if (wt.event_type == TIMERNOTIFIER) {
      WM_main_add_notifier(POINTER_AS_UINT(wt.customdata), nullptr);
    }
    else if (wt.event_type == TIMERJOBS) {
      wm_jobs_timer(wm, &wt);
    }
    else if (wmWindow *win = wt.win; wt.event_type != TIMERAUTOSAVE) {
      wmEvent event;
      wm_event_init_from_window(win, &event);
      event.type = wt.event_type;
      event.val = KM_NOTHING;
      event.keymodifier = EVENT_NONE;
      event.flag = eWM_EventFlag(0);
      event.custom = EVT_DATA_TIMER;
      event.customdata = &wt;
      WM_event_add(win, &event);
    }
  }
  wm_window_timers_delete_removed(wm);
}

/* Blender's main loop once for the page's window, with what the page added to its queue: its due timers, its events
 * and notifiers handled (wm_event_do_handlers, wm_event_do_notifiers). Returns event_result's JSON. */
/* port-override: the module has no GPU select buffer (DRW_select_buffer_*), so while the window handles events its 3D
 * Views pick edit-mesh elements as in X-ray, through each element's projection (view-api.cc's view_xray_picking); the
 * page's own shading is given back after. */
class XrayPicking {
  Vector<std::pair<View3D *, eView3DShading_Flag>> shading_;

 public:
  explicit XrayPicking(wmWindow *win)
  {
    for (ScrArea &area : WM_window_get_active_screen(win)->areabase) {
      if (area.spacetype == SPACE_VIEW3D) {
        View3D *v3d = static_cast<View3D *>(area.spacedata.first);
        shading_.append({v3d, v3d->shading.flag});
        v3d->shading.flag |= V3D_SHADING_XRAY | V3D_SHADING_XRAY_WIREFRAME;
      }
    }
  }
  ~XrayPicking()
  {
    for (const auto &[v3d, flag] : shading_) {
      v3d->shading.flag = flag;
    }
  }
};

static bContext *handling_context = nullptr;
/* The context of the event the window handles, for the module's gizmo map (editor-context.cc), or null. */
bContext *wm_handling_context() { return handling_context; }

static const char *wm_window_handle(bContext *C, FunctionRef<void(wmWindowManager *, wmWindow *)> add_events)
{
  wmWindowManager *wm = CTX_wm_manager(C);
  wmWindow *win = static_cast<wmWindow *>(wm->windows.first);
  const XrayPicking xray(win);
  bContext *outer = std::exchange(handling_context, C);
  BLI_SCOPED_DEFER([&]() { handling_context = outer; });
  Set<wmOperator *> registered;
  for (wmOperator &op : wm->runtime->operators) {
    registered.add(&op);
  }
  unhandled_handler_ensure(win);
  unhandled_events.clear();
  finished_unregistered().clear();
  wm_jobs_handle_finished(C);
  wm_window_timers_process(wm);
  add_events(wm, win);
  operator_calls_wrap();
  wm_event_do_handlers(C);
  wm_event_do_notifiers(C);
  operator_calls_unwrap();
  CTX_wm_window_set(C, win);
  return event_result(win, registered);
}

/* One input event of the page, added to the window's queue as GHOST adds it, and the window handled. */
EXPORT(wm_event)
const char *wm_event(bContext *C, int kind, const int *data, const char *code, const char *key, const char *text, double time)
{
  return wm_window_handle(C, [&](wmWindowManager *wm, wmWindow *win) {
    ghost_event_add(wm, win, kind, data, code, key, text, uint64_t(time));
  });
}

/* An operator invoked in an area's window region as a gizmo invokes its operator on a left press (the navigation
 * gizmo's buttons and axes: view3d.zoom, view3d.move, view3d.rotate, view3d.view_axis), at the pointer's last place: a
 * modal one runs in the window until the button's release. `op` holds the operator's type and properties (newOperator).
 * Returns event_result's JSON. */
EXPORT(wm_area_operator_invoke) const char *wm_area_operator_invoke(bContext *C, ScrArea *area, wmOperator *op)
{
  return wm_window_handle(C, [&](wmWindowManager * /*wm*/, wmWindow *win) {
    CTX_wm_area_set(C, area);
    CTX_wm_region_set(C, BKE_area_find_region_type(area, RGN_TYPE_WINDOW));
    wmEvent event = *win->runtime->eventstate;
    event.type = LEFTMOUSE;
    event.val = KM_PRESS;
    WM_operator_name_call_ptr(C, op->type, wm::OpCallContext::InvokeRegionWin, op->ptr, &event);
    CTX_wm_area_set(C, nullptr);
    CTX_wm_region_set(C, nullptr);
  });
}

/* The window handled with no input, for its timers and notifiers (each animation frame while it has some, wm_pending). */
EXPORT(wm_tick) const char *wm_tick(bContext *C)
{
  return wm_window_handle(C, [](wmWindowManager * /*wm*/, wmWindow * /*win*/) {});
}
/* Whether the window has work its main loop would do without input: notifiers queued (a file read's) or timers due. */
EXPORT(wm_pending) bool wm_pending(bContext *C)
{
  wmWindowManager *wm = CTX_wm_manager(C);
  if (!BLI_listbase_is_empty(&wm->runtime->notifier_queue)) {
    return true;
  }
  /* Events added outside the page's input (a file dialog's choice, fileselect.cc). */
  for (const wmWindow &win : wm->windows) {
    if (!BLI_listbase_is_empty(&win.runtime->event_queue)) {
      return true;
    }
  }
  for (const wmTimer &wt : wm->runtime->timers) {
    if (!wt.sleep && !(wt.flags & WM_TIMER_TAGGED_FOR_REMOVAL) && wt.event_type != TIMERAUTOSAVE &&
        (wt.event_type == TIMERJOBS || BLI_findindex(&wm->windows, wt.win) != -1))
    {
      return true;
    }
  }
  return false;
}

/* port-override: as wm_window.cc's, but for a context without a window manager (an operator run on its own, as Edit
 * Mode's are), whose timers nothing would run. */
wmTimer *WM_event_timer_add(wmWindowManager *wm, wmWindow *win, const wmEventType event_type, const double time_step)
{
  if (!wm) {
    return nullptr;
  }
  wmTimer *wt = MEM_new_zeroed<wmTimer>("window timer");
  wt->event_type = event_type;
  wt->time_last = BLI_time_now_seconds();
  wt->time_next = wt->time_last + time_step;
  wt->time_start = wt->time_last;
  wt->time_step = time_step;
  wt->win = win;
  BLI_addtail(&wm->runtime->timers, wt);
  return wt;
}
void WM_event_timer_remove(wmWindowManager *wm, wmWindow * /*win*/, wmTimer *timer)
{
  if (!wm || BLI_findindex(&wm->runtime->timers, timer) == -1) {
    return;
  }
  timer->flags |= WM_TIMER_TAGGED_FOR_REMOVAL;
  if (wm->runtime->reports.reporttimer == timer) {
    wm->runtime->reports.reporttimer = nullptr;
  }
  for (wmWindow &win : wm->windows) {
    for (wmEvent &event : win.runtime->event_queue) {
      if (event.customdata == timer) {
        event.customdata = nullptr;
        event.type = EVENT_NONE;
      }
    }
  }
  WM_event_timer_free_data(timer);
}

/* Puts the context in an area's region (regiontype), as the window manager does before running a region's handlers;
 * a null area clears both. */
EXPORT(wm_area_context_set) void wm_area_context_set(bContext *C, ScrArea *area, int regiontype)
{
  CTX_wm_area_set(C, area);
  CTX_wm_region_set(C, area ? BKE_area_find_region_type(area, regiontype) : nullptr);
}
/* The context's area and region, to give back after a nested one (anim-area.js inContext). */
EXPORT(wm_context_area) ScrArea *wm_context_area(bContext *C) { return CTX_wm_area(C); }
EXPORT(wm_context_region) ARegion *wm_context_region(bContext *C) { return CTX_wm_region(C); }
EXPORT(wm_context_restore) void wm_context_restore(bContext *C, ScrArea *area, ARegion *region)
{
  CTX_wm_area_set(C, area);
  CTX_wm_region_set(C, region);
}

/* A region of an area drawn by its type's draw callback (or its overlay's, draw_overlay), with the area and region the
 * context's as wm_draw.cc draws them, recorded by region-draw.cc: returns the recording's JSON. */
EXPORT(wm_region_draw) const char *wm_region_draw(bContext *C, ScrArea *area, int regiontype, bool overlay)
{
  ARegion *region = BKE_area_find_region_type(area, regiontype);
  ScrArea *area_prev = CTX_wm_area(C);
  ARegion *region_prev = CTX_wm_region(C);
  CTX_wm_area_set(C, area);
  CTX_wm_region_set(C, region);
  region_draw_begin(region->winx, region->winy);
  ui::theme::theme_set(area->spacetype, regiontype);
  (overlay ? region->runtime->type->draw_overlay : region->runtime->type->draw)(C, region);
  CTX_wm_area_set(C, area_prev);
  CTX_wm_region_set(C, region_prev);
  return region_draw_end();
}

/* port-override: the page's title is the page's; the window has no GHOST system to give a title or path to. */
void WM_window_title_refresh(wmWindowManager * /*wm*/, wmWindow * /*win*/) {}

}  // namespace blender
