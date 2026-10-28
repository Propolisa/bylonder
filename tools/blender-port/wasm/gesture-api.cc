/* The straight line gesture as wm_gesture_ops.cc defines it, for the operators that cut along a line (Bisect).
 * The file's box, circle and lasso gestures are Bylonder's window manager's (anim-api.cc), so it is not compiled
 * whole; wm_gesture.cc allocates the gesture. JS draws the line from gesture_straightline. */
#include <cmath>
#include <cstdlib>

#include "DNA_scene_types.h"
#include "DNA_screen_types.h"
#include "DNA_space_types.h"
#include "DNA_windowmanager_types.h"

#include "BLI_math_base.h"
#include "BLI_math_rotation.h"
#include "BLI_math_vector.h"
#include "BLI_rect.h"

#include "BKE_context.hh"

#include "ED_screen.hh"

#include "RNA_access.hh"

#include "WM_api.hh"
#include "WM_keymap.hh"
#include "WM_types.hh"

#define EXPORT(name) extern "C" __attribute__((export_name(#name)))

namespace blender {

void wm_gesture_tag_redraw(wmWindow *win);

static void gesture_modal_end(bContext *C, wmOperator *op)
{
  wmWindow *win = CTX_wm_window(C);
  wmGesture *gesture = static_cast<wmGesture *>(op->customdata);

  WM_gesture_end(win, gesture); /* Frees gesture itself, and unregisters from window. */
  op->customdata = nullptr;

  ED_area_tag_redraw(CTX_wm_area(C));

  if (RNA_struct_find_property(op->ptr, "cursor")) {
    WM_cursor_modal_restore(win);
  }
}

struct SnapAngle {
  float increment;
  float precise_increment;
};

static SnapAngle get_snap_angle(const ScrArea &area, const ToolSettings &tool_settings)
{
  SnapAngle snap_angle;
  if (area.spacetype == SPACE_VIEW3D) {
    snap_angle.increment = tool_settings.snap_angle_increment_3d;
    snap_angle.precise_increment = tool_settings.snap_angle_increment_3d_precision;
  }
  else {
    snap_angle.increment = tool_settings.snap_angle_increment_2d;
    snap_angle.precise_increment = tool_settings.snap_angle_increment_2d_precision;
  }

  return snap_angle;
}

static bool gesture_straightline_apply(bContext *C, wmOperator *op)
{
  wmGesture *gesture = static_cast<wmGesture *>(op->customdata);
  const rcti *rect = static_cast<const rcti *>(gesture->customdata);

  if (rect->xmin == rect->xmax && rect->ymin == rect->ymax) {
    return false;
  }

  /* Operator arguments and storage. */
  RNA_int_set(op->ptr, "xstart", rect->xmin);
  RNA_int_set(op->ptr, "ystart", rect->ymin);
  RNA_int_set(op->ptr, "xend", rect->xmax);
  RNA_int_set(op->ptr, "yend", rect->ymax);
  RNA_boolean_set(op->ptr, "flip", gesture->use_flip);

  if (op->type->exec) {
    const wmOperatorStatus retval = op->type->exec(C, op);
    OPERATOR_RETVAL_CHECK(retval);
  }

  return true;
}

wmOperatorStatus WM_gesture_straightline_invoke(bContext *C, wmOperator *op, const wmEvent *event)
{
  wmWindow *win = CTX_wm_window(C);
  PropertyRNA *prop;

  op->customdata = WM_gesture_new(win, CTX_wm_region(C), event, WM_GESTURE_STRAIGHTLINE);

  if (WM_event_is_mouse_drag_or_press(event)) {
    wmGesture *gesture = static_cast<wmGesture *>(op->customdata);
    gesture->is_active = true;
  }

  /* Add modal handler. */
  WM_event_add_modal_handler(C, op);

  wm_gesture_tag_redraw(win);

  if ((prop = RNA_struct_find_property(op->ptr, "cursor"))) {
    WM_cursor_modal_set(win, RNA_property_int_get(op->ptr, prop));
  }

  return OPERATOR_RUNNING_MODAL;
}
wmOperatorStatus WM_gesture_straightline_active_side_invoke(bContext *C, wmOperator *op, const wmEvent *event)
{
  WM_gesture_straightline_invoke(C, op, event);
  wmGesture *gesture = static_cast<wmGesture *>(op->customdata);
  gesture->draw_active_side = true;
  gesture->use_flip = false;
  return OPERATOR_RUNNING_MODAL;
}

static void wm_gesture_straightline_do_angle_snap(rcti *rect, float snap_angle)
{
  const float line_start[2] = {float(rect->xmin), float(rect->ymin)};
  const float line_end[2] = {float(rect->xmax), float(rect->ymax)};
  const float x_axis[2] = {1.0f, 0.0f};

  float line_direction[2];
  sub_v2_v2v2(line_direction, line_end, line_start);
  const float line_length = normalize_v2(line_direction);

  const float current_angle = angle_signed_v2v2(x_axis, line_direction);
  const float adjusted_angle = current_angle + (snap_angle / 2.0f);
  const float angle_snapped = -floorf(adjusted_angle / snap_angle) * snap_angle;

  float line_snapped_end[2];
  rotate_v2_v2fl(line_snapped_end, x_axis, angle_snapped);
  mul_v2_fl(line_snapped_end, line_length);
  add_v2_v2(line_snapped_end, line_start);

  rect->xmax = int(line_snapped_end[0]);
  rect->ymax = int(line_snapped_end[1]);

  /* Check whether `angle_snapped` is a multiple of 45 degrees, if so ensure X and Y directions
   * are the same length (there could be an off-by-one due to rounding error). */
  const float fract_45 = fractf(angle_snapped / DEG2RADF(45.0f));
  const float fract_90 = fractf(angle_snapped / DEG2RADF(90.0f));
  /* Check if it's a multiple of 45 but not 90 degrees. */
  if ((compare_ff(fract_45, 0.0f, 1e-6) || compare_ff(fabsf(fract_45), 1.0f, 1e-6)) &&
      !(compare_ff(fract_90, 0.0f, 1e-6) || compare_ff(fabsf(fract_90), 1.0f, 1e-6)))
  {
    int xlen = abs(rect->xmax - rect->xmin);
    int ylen = rect->ymax - rect->ymin;
    if (abs(ylen) != xlen) {
      ylen = xlen * (ylen >= 0 ? 1 : -1);
      rect->ymax = rect->ymin + ylen;
    }
  }
}

wmOperatorStatus WM_gesture_straightline_modal(bContext *C, wmOperator *op, const wmEvent *event)
{
  const Scene *scene = CTX_data_scene(C);
  const ScrArea *area = CTX_wm_area(C);
  const SnapAngle snap_angle = get_snap_angle(*area, *scene->toolsettings);

  wmGesture *gesture = static_cast<wmGesture *>(op->customdata);
  wmWindow *win = CTX_wm_window(C);
  rcti *rect = static_cast<rcti *>(gesture->customdata);

  if (event->type == EVT_MODAL_MAP) {
    switch (event->val) {
      case GESTURE_MODAL_MOVE: {
        gesture->move = !gesture->move;
        break;
      }
      case GESTURE_MODAL_BEGIN: {
        if (gesture->is_active == false) {
          gesture->is_active = true;
          wm_gesture_tag_redraw(win);
        }
        break;
      }
      case GESTURE_MODAL_SNAP: {
        /* Toggle snapping on/off. */
        gesture->use_snap = !gesture->use_snap;
        break;
      }
      case GESTURE_MODAL_FLIP: {
        /* Toggle flipping on/off. */
        gesture->use_flip = !gesture->use_flip;
        gesture_straightline_apply(C, op);
        wm_gesture_tag_redraw(win);
        break;
      }
      case GESTURE_MODAL_SELECT: {
        if (gesture_straightline_apply(C, op)) {
          gesture_modal_end(C, op);
          return OPERATOR_FINISHED;
        }
        gesture_modal_end(C, op);
        return OPERATOR_CANCELLED;
      }
      case GESTURE_MODAL_CANCEL: {
        gesture_modal_end(C, op);
        return OPERATOR_CANCELLED;
      }
    }
  }
  else {
    switch (event->type) {
      case MOUSEMOVE: {
        if (gesture->is_active == false) {
          rect->xmin = rect->xmax = event->xy[0] - gesture->winrct.xmin;
          rect->ymin = rect->ymax = event->xy[1] - gesture->winrct.ymin;
        }
        else if (gesture->move) {
          BLI_rcti_translate(rect,
                             (event->xy[0] - gesture->winrct.xmin) - rect->xmax,
                             (event->xy[1] - gesture->winrct.ymin) - rect->ymax);
          gesture_straightline_apply(C, op);
        }
        else {
          rect->xmax = event->xy[0] - gesture->winrct.xmin;
          rect->ymax = event->xy[1] - gesture->winrct.ymin;
          gesture_straightline_apply(C, op);
        }

        if (gesture->use_snap) {
          wm_gesture_straightline_do_angle_snap(rect, snap_angle.increment);
          gesture_straightline_apply(C, op);
        }

        wm_gesture_tag_redraw(win);

        break;
      }
      default: {
        break;
      }
    }
  }

  gesture->is_active_prev = gesture->is_active;
  return OPERATOR_RUNNING_MODAL;
}

void WM_gesture_straightline_cancel(bContext *C, wmOperator *op)
{
  gesture_modal_end(C, op);
}

/* As wm_operators.cc's gesture_straightline_modal_keymap makes it, for the operators the module has. */
void gesture_straightline_modal_keymap(wmKeyConfig *keyconf)
{
  static const EnumPropertyItem modal_items[] = {
      {GESTURE_MODAL_CANCEL, "CANCEL", 0, "Cancel", ""},
      {GESTURE_MODAL_SELECT, "SELECT", 0, "Select", ""},
      {GESTURE_MODAL_BEGIN, "BEGIN", 0, "Begin", ""},
      {GESTURE_MODAL_MOVE, "MOVE", 0, "Move", ""},
      {GESTURE_MODAL_SNAP, "SNAP", 0, "Snap", ""},
      {GESTURE_MODAL_FLIP, "FLIP", 0, "Flip", ""},
      {0, nullptr, 0, nullptr, nullptr},
  };
  wmKeyMap *keymap = WM_modalkeymap_ensure(keyconf, "Gesture Straight Line", modal_items);
  WM_modalkeymap_assign(keymap, "MESH_OT_bisect");
}

}  // namespace blender

/* A running straight line gesture of an operator, for JS to draw (wm_gesture_draw_line): whether it began, its
 * start and end in region pixels (y up), and whether it shows the side kept and that side flipped; null without
 * one. */
EXPORT(gesture_straightline) const int *gesture_straightline(blender::wmOperator *op)
{
  static int out[7];
  const blender::wmGesture *gesture = static_cast<const blender::wmGesture *>(op->customdata);
  if (!gesture || gesture->type != WM_GESTURE_STRAIGHTLINE) {
    return nullptr;
  }
  const blender::rcti *rect = static_cast<const blender::rcti *>(gesture->customdata);
  out[0] = gesture->is_active;
  out[1] = rect->xmin;
  out[2] = rect->ymin;
  out[3] = rect->xmax;
  out[4] = rect->ymax;
  out[5] = gesture->draw_active_side;
  out[6] = gesture->use_flip;
  return out;
}
