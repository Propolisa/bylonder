/* Dragging and dropping as the window manager runs it (wm_event_system.cc, wm_dragdrop.cc), for the dropbox handlers of
 * the context's region: Bylonder's window manager (JS) finds the region under the pointer and makes it the context's.
 * Drags start as Blender's operators start them (WM_event_start_prepared_drag), in the window manager's drags. */
#include "BKE_context.hh"
#include "BKE_screen.hh"
#include "BKE_wm_runtime.hh"
#include "BLI_listbase.h"
#include "DNA_screen_types.h"
#include "DNA_windowmanager_types.h"
#include "ED_screen.hh"
#include "WM_api.hh"
#include "WM_types.hh"
#include "../windowmanager/wm_event_system.hh"
#include "rna-runtime.hh"

using namespace blender;

#define EXPORT(name) extern "C" __attribute__((export_name(#name)))

extern "C" void operator_free(wmOperator *op);

namespace blender {

void WM_operator_free(wmOperator *op) { operator_free(op); }

bool wm_operator_blocked(wmOperatorType *ot);
/* As wm_event_system.cc defines them, for operators run in the context's area and region; an operator the page runs
 * itself does not poll in the window's event handling (wm_operator_blocked). */
bool WM_operator_poll(bContext *C, wmOperatorType *ot) { return !wm_operator_blocked(ot) && (!ot->poll || ot->poll(C)); }
bool WM_operator_poll_context(bContext *C, wmOperatorType *ot, wm::OpCallContext /*context*/) { return WM_operator_poll(C, ot); }
wmEventHandler_Dropbox *WM_event_add_dropbox_handler(ListBaseT<wmEventHandler> *handlers, ListBaseT<wmDropBox> *dropboxes)
{
  for (wmEventHandler &handler_base : *handlers) {
    if (handler_base.type == WM_HANDLER_TYPE_DROPBOX &&
        reinterpret_cast<wmEventHandler_Dropbox *>(&handler_base)->dropboxes == dropboxes)
    {
      return reinterpret_cast<wmEventHandler_Dropbox *>(&handler_base);
    }
  }
  wmEventHandler_Dropbox *handler = MEM_new_zeroed<wmEventHandler_Dropbox>(__func__);
  handler->head.type = WM_HANDLER_TYPE_DROPBOX;
  handler->dropboxes = dropboxes;
  BLI_addhead(handlers, handler);
  return handler;
}

/* port-override: Bylonder's window manager runs one modal operator at a time (operator_modal_added), so an operator
 * another one calls runs only when it has an exec (the Outliner's drag calls the modal VIEW2D_OT_edge_pan). */
wmOperatorStatus WM_operator_name_call_ptr(bContext *C, wmOperatorType *ot, wm::OpCallContext /*context*/,
                                           PointerRNA *properties, const wmEvent * /*event*/)
{
  if (!ot->exec || !WM_operator_poll(C, ot)) {
    return OPERATOR_CANCELLED;
  }
  wmOperator *op = operator_create(ot, properties ? static_cast<IDProperty *>(properties->data) : nullptr);
  const wmOperatorStatus status = ot->exec(C, op);
  WM_operator_free(op);
  return status;
}

/* As area.cc defines them. */
ScrArea *ED_screen_areas_iter_first(const wmWindow *win, const bScreen *screen)
{
  ScrArea *global_area = static_cast<ScrArea *>(win->global_areas.areabase.first);
  if (!global_area) {
    return static_cast<ScrArea *>(screen->areabase.first);
  }
  if ((global_area->global->flag & GLOBAL_AREA_IS_HIDDEN) == 0) {
    return global_area;
  }
  return ED_screen_areas_iter_next(screen, global_area);
}
ScrArea *ED_screen_areas_iter_next(const bScreen *screen, const ScrArea *area)
{
  if (area->global == nullptr) {
    return area->next;
  }
  for (ScrArea *area_iter = area->next; area_iter; area_iter = area_iter->next) {
    if ((area_iter->global->flag & GLOBAL_AREA_IS_HIDDEN) == 0) {
      return area_iter;
    }
  }
  return static_cast<ScrArea *>(screen->areabase.first);
}

/* port-override: Bylonder's window manager redraws its areas. */
wmWindow *WM_window_find_under_cursor(wmWindow * /*win*/, const int /*event_xy*/[2], int /*r_event_xy_other*/[2])
{
  return nullptr;
}

}  // namespace blender

static ListBaseT<wmDrag> &drags(bContext *C) { return CTX_wm_manager(C)->runtime->drags; }
template<typename Fn> static void region_dropboxes(bContext *C, Fn fn)
{
  for (wmEventHandler &handler_base : CTX_wm_region(C)->runtime->handlers) {
    if (handler_base.type == WM_HANDLER_TYPE_DROPBOX) {
      for (wmDropBox &drop : *reinterpret_cast<wmEventHandler_Dropbox *>(&handler_base)->dropboxes) {
        if (fn(drop)) {
          return;
        }
      }
    }
  }
}

EXPORT(drag_running) bool drag_running(bContext *C) { return !drags(C).is_empty(); }

/* The drags' active dropboxes for the pointer's place in the context's region, as wm_drop_update_active finds them:
 * returns the tooltip of the first drag's (the operator's name) or its reason it cannot drop, or an empty string. */
EXPORT(drag_update) const char *drag_update(bContext *C, const wmEvent *event)
{
  static std::string tooltip;
  tooltip.clear();
  for (wmDrag &drag : drags(C)) {
    drag.drop_state.tooltip.clear();
    drag.drop_state.disabled_info = std::nullopt;
    wmDropBox *active = nullptr;
    region_dropboxes(C, [&](wmDropBox &drop) {
      if (!drop.poll(C, &drag, event)) {
        return false;
      }
      if (drop.ot && WM_operator_poll_context(C, drop.ot, wm_drop_operator_context_get(&drop))) {
        drag.drop_state.tooltip = drop.tooltip ? drop.tooltip(C, &drag, event->xy, &drop) :
                                                 WM_operatortype_name(drop.ot, drop.ptr);
        active = &drop;
        return true;
      }
      bool free = false;
      if (const char *hint = CTX_wm_operator_poll_msg_get(C, &free)) {
        drag.drop_state.disabled_info = hint;
        if (free) {
          MEM_SAFE_DELETE(hint);
        }
      }
      return false;
    });
    drag.drop_state.active_dropbox = active;
    if (tooltip.empty()) {
      tooltip = active ? drag.drop_state.tooltip : drag.drop_state.disabled_info.value_or("");
    }
  }
  return tooltip.c_str();
}

/* Ends the drags (Escape, or the drop is outside any region with dropboxes). */
EXPORT(drag_cancel) void drag_cancel(bContext *C)
{
  WM_drag_free_list(&drags(C));
}

/* The button's release over the context's region, as wm_event_drag_and_drop makes it an EVT_DROP and
 * wm_handlers_do_intern gives it to the region's dropbox handlers: the first dropbox that polls runs its operator with
 * the matching drag. Returns the operator's wmOperatorStatus, or 0 when nothing dropped; the drags end either way. */
EXPORT(drag_drop) int drag_drop(bContext *C, wmEvent *event)
{
  ListBaseT<wmDrag> *lb = &drags(C);
  event->type = EVT_DROP;
  event->custom = EVT_DATA_DRAGDROP;
  event->customdata = lb;
  int status = 0;
  region_dropboxes(C, [&](wmDropBox &drop) {
    for (wmDrag &drag : lb->items_mutable()) {
      if (!drop.poll(C, &drag, event)) {
        continue;
      }
      wm_drop_prepare(C, &drag, &drop);
      BLI_remlink(lb, &drag);
      ListBaseT<wmDrag> single_lb = {nullptr};
      BLI_addtail(&single_lb, &drag);
      event->customdata = &single_lb;
      status = OPERATOR_CANCELLED;
      if (WM_operator_poll(C, drop.ot)) {
        wmOperator *op = operator_create(drop.ot, static_cast<IDProperty *>(drop.ptr->data));
        status = drop.ot->invoke ? drop.ot->invoke(C, op, event) : drop.ot->exec(C, op);
        WM_operator_free(op);
      }
      if ((status & OPERATOR_CANCELLED) && drop.cancel) {
        drop.cancel(CTX_data_main(C), &drag, &drop);
      }
      WM_drag_free_list(&single_lb);
      wm_drop_end(C, &drag, &drop);
      return true;
    }
    return false;
  });
  WM_drag_free_list(lb);
  event->custom = 0;
  event->customdata = nullptr;
  return status;
}
