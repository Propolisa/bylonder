/* Blender's gesture operators (wm_gesture_ops.cc) whole, for the page's window: the box, circle and lasso that
 * operators start while the window handles an event run there as in Blender (anim-api.cc dispatches to them), and
 * wm_gestures gives the page what to draw of them (wm_gesture_draw's shapes). Its names are prefixed: anim-api.cc's
 * and gesture-api.cc's are the module's public ones until every editor's input goes through the window. */
#define WM_gesture_box_invoke wmg_WM_gesture_box_invoke
#define WM_gesture_box_modal wmg_WM_gesture_box_modal
#define WM_gesture_box_cancel wmg_WM_gesture_box_cancel
#define WM_gesture_circle_invoke wmg_WM_gesture_circle_invoke
#define WM_gesture_circle_modal wmg_WM_gesture_circle_modal
#define WM_gesture_circle_cancel wmg_WM_gesture_circle_cancel
#define WM_gesture_lasso_invoke wmg_WM_gesture_lasso_invoke
#define WM_gesture_lasso_modal wmg_WM_gesture_lasso_modal
#define WM_gesture_lasso_cancel wmg_WM_gesture_lasso_cancel
#define WM_gesture_lasso_path_to_array wmg_WM_gesture_lasso_path_to_array
#define WM_gesture_lines_invoke wmg_WM_gesture_lines_invoke
#define WM_gesture_lines_modal wmg_WM_gesture_lines_modal
#define WM_gesture_lines_cancel wmg_WM_gesture_lines_cancel
#define WM_gesture_polyline_invoke wmg_WM_gesture_polyline_invoke
#define WM_gesture_polyline_modal wmg_WM_gesture_polyline_modal
#define WM_gesture_polyline_cancel wmg_WM_gesture_polyline_cancel
#define WM_gesture_straightline_invoke wmg_WM_gesture_straightline_invoke
#define WM_gesture_straightline_active_side_invoke wmg_WM_gesture_straightline_active_side_invoke
#define WM_gesture_straightline_modal wmg_WM_gesture_straightline_modal
#define WM_gesture_straightline_oneshot_modal wmg_WM_gesture_straightline_oneshot_modal
#define WM_gesture_straightline_cancel wmg_WM_gesture_straightline_cancel
#define WM_OT_circle_gesture wmg_WM_OT_circle_gesture
#define WM_OT_lasso_gesture wmg_WM_OT_lasso_gesture
#define WM_OT_polyline_gesture wmg_WM_OT_polyline_gesture
#define WM_OT_straightline_gesture wmg_WM_OT_straightline_gesture
#include "intern/wm_gesture_ops.cc"

#include "BKE_wm_runtime.hh"
#include "BLI_listbase.h"

#include <string>

#define EXPORT(name) extern "C" __attribute__((export_name(#name)))

using namespace blender;

/* The window's running gestures as JSON for the page to draw, in page pixels (y down): [{ type: 'BOX', rect: [left,
 * top, right, bottom] }, { type: 'CIRCLE', center, radius }, { type: 'LASSO' or 'LINES', points }], as wm_gesture_draw
 * draws them. */
EXPORT(wm_gestures) const char *wm_gestures(bContext *C)
{
  static std::string json;
  wmWindow *win = static_cast<wmWindow *>(CTX_wm_manager(C)->windows.first);
  const auto point = [&](const rcti &winrct, int x, int y) {
    return std::to_string(winrct.xmin + x) + "," + std::to_string(win->sizey - 1 - (winrct.ymin + y));
  };
  json = "[";
  for (const wmGesture &gesture : win->runtime->gesture) {
    const std::string next = json.size() > 1 ? "," : "";
    if (ELEM(gesture.type, WM_GESTURE_RECT, WM_GESTURE_CROSS_RECT)) {
      rcti rect = *static_cast<const rcti *>(gesture.customdata);
      BLI_rcti_sanitize(&rect);
      json += next + "{\"type\":\"BOX\",\"rect\":[" + point(gesture.winrct, rect.xmin, rect.ymax) + "," +
              point(gesture.winrct, rect.xmax, rect.ymin) + "]}";
    }
    else if (gesture.type == WM_GESTURE_CIRCLE) {
      const rcti &rect = *static_cast<const rcti *>(gesture.customdata);
      json += next + "{\"type\":\"CIRCLE\",\"center\":[" + point(gesture.winrct, rect.xmin, rect.ymin) +
              "],\"radius\":" + std::to_string(rect.xmax) + "}";
    }
    else if (ELEM(gesture.type, WM_GESTURE_LASSO, WM_GESTURE_LINES, WM_GESTURE_POLYLINE)) {
      const short(*points)[2] = static_cast<const short(*)[2]>(gesture.customdata);
      json += next + "{\"type\":\"" + (gesture.type == WM_GESTURE_LASSO ? "LASSO" : "LINES") + "\",\"points\":[";
      for (int i = 0; i < gesture.points; i++) {
        json += std::string(i ? ",[" : "[") + point(gesture.winrct, points[i][0], points[i][1]) + "]";
      }
      json += "]}";
    }
  }
  json += "]";
  return json.c_str();
}
