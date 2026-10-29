/* Blender's window manager over the browser. Main's window manager has one window, a GHOST window of the browser
 * (ghost-window.cc), whose screen holds areas made by their space types as Blender makes them. The browser lays the
 * areas out (CSS) and gives their rectangles here, one way; it turns its input into GHOST events, which Blender's own
 * event system handles (wm_event_add_ghostevent, wm_event_do_handlers, wm_event_do_notifiers): the keymaps of the
 * window, areas and regions, modal operators, macros and gestures run as in Blender. Each event returns what Blender
 * tagged for redrawing. */
#include "BKE_context.hh"
#include "BKE_global.hh"
#include "BKE_lib_remap.hh"
#include "BKE_main.hh"
#include "BKE_screen.hh"
#include "BLI_listbase.h"
#include "BLI_map.hh"
#include "BLI_math_matrix.h"
#include "BLI_math_rotation.h"
#include "BLI_rect.h"
#include "BLI_set.hh"
#include "BLI_string.h"
#include "BLI_function_ref.hh"
#include "BLI_time.h"
#include "DNA_screen_types.h"
#include "DNA_space_types.h"
#include "DNA_view3d_types.h"
#include "DNA_windowmanager_types.h"
#include "ED_screen.hh"
#include "ED_space_api.hh"
#include "ED_util.hh"
#include "GPU_context.hh"
#include "MEM_guardedalloc.h"
#include "RNA_access.hh"
#include "UI_resources.hh"
#include "RNA_enum_types.hh"
#include "WM_api.hh"
#include "WM_keymap.hh"
#include "WM_types.hh"
#include "wm.hh"
#include "wm_event_system.hh"
#include "wm_window.hh"

#include "GHOST_IWindow.hh"

#include "area.hh"
#include "rna-runtime.hh"

#include <algorithm>
#include <string>

#define EXPORT(name) extern "C" __attribute__((export_name(#name)))

GHOST_IWindow *ghost_window_new(uint32_t width, uint32_t height);
extern "C" void region_draw_begin(int winx, int winy);
extern "C" const char *region_draw_end();
GHOST_TKey ghost_key_from_browser(const char *code, const char *key);
void view3d_matrices_set(blender::RegionView3D &rv3d, const float *viewmat, const float *winmat, int winx, int winy, bool is_persp);

namespace blender {

std::string operator_popup_json();
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

/* The window manager as WM_init sets it up for its window (wm_window_ghostwindow_ensure, WM_keyconfig_init): the
 * key configurations with the keymaps Blender's C defines (their items come from keyconfig data, wm_keymap_item_new),
 * the window's GHOST window and its handlers. */
void wm_init(bContext *C)
{
  wmWindowManager *wm = CTX_wm_manager(C);
  wmWindow *win = CTX_wm_window(C);
  wm->runtime->defaultconf = WM_keyconfig_new(wm, WM_KEYCONFIG_STR_DEFAULT, false);
  wm->runtime->addonconf = WM_keyconfig_new(wm, WM_KEYCONFIG_STR_DEFAULT " addon", false);
  wm->runtime->userconf = WM_keyconfig_new(wm, WM_KEYCONFIG_STR_DEFAULT " user", false);
  wm_window_keymap(wm->runtime->defaultconf);
  ED_spacetypes_keymap(wm->runtime->defaultconf);
  wm->runtime->defaultconf->flag |= KEYCONF_INIT_DEFAULT;

  BKE_library_callback_remap_editor_id_reference_set(editor_id_remap);
  win->runtime->ghostwin = ghost_window_new(1, 1);
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
  ED_area_exit(C, area);
  BLI_remlink(&screen->areabase, area);
  BKE_screen_area_free(area);
  MEM_delete(reinterpret_cast<BylonderArea *>(area));
  BKE_screen_remove_unused_scrverts(screen);
}

/* A rectangle of the page (pixels from its top left) in Blender's window coordinates (from its bottom left). */
static rcti window_rect(const wmWindow *win, const int *rect)
{
  const int x = rect[0], y = win->sizey - rect[1] - rect[3];
  return rcti{x, x + rect[2] - 1, y, y + rect[3] - 1};
}

/* An area's place and its regions' as the page lays them out: (regiontype, x, y, width, height) for the area (-1)
 * and each region it shows, in page pixels; the regions it does not list are hidden. The first layout initializes
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
  for (ARegion &region : area->regionbase) {
    const int *shown = nullptr;
    for (int i = 1; i < count; i++) {
      if (rects[i * 5] == region.regiontype) {
        shown = rects + i * 5 + 1;
      }
    }
    SET_FLAG_FROM_TEST(region.flag, !shown, RGN_FLAG_HIDDEN);
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

/* A 3D View's view as the page's camera has it (port-override: Bylonder navigates the view, ED_view3d_update_viewmat
 * with Babylon's camera as its matrices): view and window matrices (Blender's axes, column-major) and whether it is a
 * perspective view, for its window region. */
EXPORT(wm_view3d_set) void wm_view3d_set(ScrArea *area, const float *viewmat, const float *winmat, bool is_persp)
{
  ARegion *region = BKE_area_find_region_type(area, RGN_TYPE_WINDOW);
  view3d_matrices_set(*static_cast<RegionView3D *>(region->regiondata), viewmat, winmat, region->winx, region->winy, is_persp);
}

/* The browser's input as GHOST's events: the pointer's place (page pixels), a button pressed or released (the DOM's
 * button number, which is GHOST's), the wheel, a trackpad's scroll or zoom, a key pressed (with its text) or released
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

static void ghost_event_add(wmWindowManager *wm, wmWindow *win, int kind, const int *data, const char *code, const char *key,
                            const char *text, uint64_t time)
{
  switch (kind) {
    case BROWSER_POINTER_MOVE: {
      GHOST_TEventCursorData cursor = {data[0], data[1], GHOST_TABLET_DATA_NONE};
      wm_event_add_ghostevent(wm, win, GHOST_kEventCursorMove, &cursor, time);
      break;
    }
    case BROWSER_BUTTON_DOWN:
    case BROWSER_BUTTON_UP: {
      GHOST_TEventButtonData button = {GHOST_TButton(data[0]), GHOST_TABLET_DATA_NONE};
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
 * allows (wm_operators_allow, those whose Bylonder registration runs Blender's). A keymap item of another operator
 * handles its event as Blender's would, but by passing it on to the page, whose keymaps run that operator
 * (unhandled_events): while the window handles an event, the types' invoke (or exec) are wrapped to do so. The wrapping
 * lasts only that long, so types registered or copied at any other time see their own functions. */
static Set<const wmOperatorType *> &allowed_operators()
{
  static Set<const wmOperatorType *> allowed;
  return allowed;
}

/* An operator is allowed, or a step of a macro that is (its steps are the macro's). */
static bool operator_allowed(const wmOperator *op)
{
  for (; op; op = op->opm) {
    if (allowed_operators().contains(op->type)) {
      return true;
    }
  }
  return false;
}

struct OperatorCalls {
  decltype(wmOperatorType::invoke) invoke;
  decltype(wmOperatorType::exec) exec;
};
static Map<wmOperatorType *, OperatorCalls> &operator_calls()
{
  static Map<wmOperatorType *, OperatorCalls> calls;
  return calls;
}
static wmOperatorStatus page_invoke(bContext *C, wmOperator *op, const wmEvent *event)
{
  if (!operator_allowed(op)) {
    unhandled_event(C, event, nullptr);
    return OPERATOR_CANCELLED;
  }
  return operator_calls().lookup(op->type).invoke(C, op, event);
}
static wmOperatorStatus page_exec(bContext *C, wmOperator *op)
{
  if (!operator_allowed(op)) {
    unhandled_event(C, CTX_wm_window(C)->runtime->eventstate, nullptr);
    return OPERATOR_CANCELLED;
  }
  return operator_calls().lookup(op->type).exec(C, op);
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
    operator_calls().add_new(ot, {ot->invoke, ot->exec});
    if (ot->invoke) {
      ot->invoke = page_invoke;
    }
    else if (ot->exec) {
      ot->exec = page_exec;
    }
  }
}
static void operator_calls_unwrap()
{
  handling = false;
  for (auto [ot, calls] : operator_calls().items()) {
    ot->invoke = calls.invoke;
    ot->exec = calls.exec;
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
 * operators that finished (registered for redo: idname and whether a run is an undo step), the popup or menu an
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
  for (wmOperator &op : wm->runtime->operators) {
    if (!registered.contains(&op)) {
      json += std::string(json.back() == '[' ? "" : ",") + "{\"idname\":\"" + op.type->idname + "\",\"undo\":" +
              ((op.type->flag & OPTYPE_UNDO) ? "true" : "false") + "}";
    }
  }
  json += "],\"popup\":" + operator_popup_json() + ",\"unhandled\":[" + unhandled_events + "]}";
  return json.c_str();
}

/* port-override: wm_window_timers_process (wm_window.cc) for the page's window, which has no GHOST loop to run it: the
 * window timers that are due become TIMER events in its queue (panel animations, tooltips, modal operators' timers),
 * notifier timers add their notifiers. Jobs and autosave have no timers here. */
static void wm_window_timers_process(wmWindowManager *wm)
{
  const double time = BLI_time_now_seconds();
  for (wmTimer &wt : wm->runtime->timers.items_mutable()) {
    if ((wt.flags & WM_TIMER_TAGGED_FOR_REMOVAL) || wt.sleep || wt.time_next >= time) {
      continue;
    }
    if (wt.event_type != TIMERNOTIFIER && BLI_findindex(&wm->windows, wt.win) == -1) {
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
    else if (wmWindow *win = wt.win; !ELEM(wt.event_type, TIMERJOBS, TIMERAUTOSAVE)) {
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
static const char *wm_window_handle(bContext *C, FunctionRef<void(wmWindowManager *, wmWindow *)> add_events)
{
  wmWindowManager *wm = CTX_wm_manager(C);
  wmWindow *win = static_cast<wmWindow *>(wm->windows.first);
  Set<wmOperator *> registered;
  for (wmOperator &op : wm->runtime->operators) {
    registered.add(&op);
  }
  unhandled_handler_ensure(win);
  unhandled_events.clear();
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

/* The window handled with no input, for its timers (each animation frame while it has some, wm_timers_active). */
EXPORT(wm_tick) const char *wm_tick(bContext *C)
{
  return wm_window_handle(C, [](wmWindowManager * /*wm*/, wmWindow * /*win*/) {});
}
EXPORT(wm_timers_active) bool wm_timers_active(bContext *C)
{
  wmWindowManager *wm = CTX_wm_manager(C);
  for (const wmTimer &wt : wm->runtime->timers) {
    if (!wt.sleep && !(wt.flags & WM_TIMER_TAGGED_FOR_REMOVAL) && !ELEM(wt.event_type, TIMERJOBS, TIMERAUTOSAVE) &&
        BLI_findindex(&wm->windows, wt.win) != -1)
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

/* port-override: the GPU module is past the seam (the browser draws), so the window has no GPU context to make
 * current around the handlers. */
void GPU_render_begin() {}
void GPU_render_end() {}
void GPU_render_step(bool /*force_resource_release*/) {}
void GPU_context_active_set(GPUContext * /*ctx*/) {}
GPUContext *GPU_context_active_get() { return nullptr; }
void GPU_context_main_lock() {}
void GPU_context_main_unlock() {}

}  // namespace blender
