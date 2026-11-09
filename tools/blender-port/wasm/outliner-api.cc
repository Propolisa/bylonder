/* The Outliner: an area of Blender's window (wm_area_new) whose SpaceOutliner and regions are Blender's, whose tree
 * Blender's own code builds, draws, selects and edits (editors/space_outliner) over the module's Main. Its main region
 * draws through wm_region_draw; its operators run in its context (wm_area_context_set) by editor-context's invoke and
 * exec. */
#include "BKE_context.hh"
#include "BKE_icons.hh"
#include "BKE_layer.hh"
#include "BKE_lib_remap.hh"
#include "BKE_screen.hh"
#include "BLI_listbase.h"
#include "BLI_rect.h"
#include "DEG_depsgraph.hh"
#include "DNA_layer_types.h"
#include "DNA_screen_types.h"
#include "DNA_space_types.h"
#include "DNA_userdef_types.h"
#include "ED_screen.hh"
#include "ED_space_api.hh"
#include "RNA_access.hh"
#include "RNA_prototypes.hh"
#include "UI_interface_c.hh"
#include "UI_interface_icons.hh"
#include "UI_resources.hh"
#include "UI_view2d.hh"
#include "WM_api.hh"
#include "WM_types.hh"

#include "../editors/space_outliner/outliner_intern.hh"
#include "rna-runtime.hh"

using namespace blender;

#define EXPORT(name) extern "C" __attribute__((export_name(#name)))


/* As WM_init initializes the interface (UI_init): the resolution WM_window_dpi_set_userdef sets at Blender's default
 * scale of 1, the default theme (userdef_default_theme.c), the default style and the icons, whose dynamic ids (tool
 * icons, previews) follow the static ones (BKE_icons_init). */
void ui_init()
{
  U.dpi = 72;
  U.scale_factor = 1.0f;
  U.inv_scale_factor = 1.0f;
  U.pixelsize = 1.0f;
  U.widget_unit = 20;
  /* port-override: views change at once; Bylonder's window manager has no timers to animate them. */
  U.smooth_viewtx = 0;
  ui::theme::init_default();
  ui::style_init_default();
  BKE_icons_init(BIFICONID_LAST_STATIC);
  ui::icons_init();
}


static ARegion *main_region(ScrArea *area) { return BKE_area_find_region_type(area, RGN_TYPE_WINDOW); }

static SpaceOutliner *space(ScrArea *area) { return static_cast<SpaceOutliner *>(area->spacedata.first); }

/* An Outliner area (wm_area_new's) set up as Bylonder's. port-override: Bylonder's Outliner stands for the one of the
 * file it opens, which syncs its selection from the view layer's only once that changes, rather than for one made at
 * runtime, which syncs at once. */
EXPORT(outliner_area_init) void outliner_area_init(ScrArea *area) { space(area)->sync_select_dirty = 0; }

EXPORT(outliner_space) SpaceOutliner *outliner_space(ScrArea *area) { return space(area); }
EXPORT(outliner_region) ARegion *outliner_region(ScrArea *area) { return main_region(area); }
EXPORT(outliner_region_v2d) View2D *outliner_region_v2d(ScrArea *area) { return &main_region(area)->v2d; }

/* The main region's size in pixels, and its 2D view and dropboxes as outliner_main_region_init sets them up (its keymap
 * is Bylonder's window manager's). */
EXPORT(outliner_region_size) void outliner_region_size(ScrArea *area, int x, int y, int winx, int winy)
{
  ARegion *region = main_region(area);
  region->winx = short(winx);
  region->winy = short(winy);
  region->winrct = {x, x + winx - 1, y, y + winy - 1};
  /* As region_rect_recursive leaves a shown region: its blocks take their matrix and aspect from it
   * (ui_update_window_matrix), which places the icon labels of the tree's rows. */
  region->runtime->visible = true;
  region->flag |= RGN_FLAG_INDICATE_OVERFLOW;
  region->v2d.scroll |= (V2D_SCROLL_RIGHT | V2D_SCROLL_BOTTOM);
  region->v2d.scroll &= ~(V2D_SCROLL_LEFT | V2D_SCROLL_TOP);
  region->v2d.scroll |= V2D_SCROLL_HORIZONTAL_HIDE;
  region->v2d.scroll |= V2D_SCROLL_VERTICAL_HIDE;
  region->v2d.align = (V2D_ALIGN_NO_NEG_X | V2D_ALIGN_NO_POS_Y);
  region->v2d.keepzoom = (V2D_LOCKZOOM_X | V2D_LOCKZOOM_Y | V2D_LIMITZOOM | V2D_KEEPASPECT);
  region->v2d.keeptot = V2D_KEEPTOT_STRICT;
  region->v2d.minzoom = region->v2d.maxzoom = 1.0f;
  ui::view2d_region_reinit(&region->v2d, ui::V2D_COMMONVIEW_LIST, region->winx, region->winy);
  /* As region_azones_scrollbars_init: the scroll-bars are hidden until the mouse comes near. */
  region->v2d.alpha_vert = region->v2d.alpha_hor = 0;
  WM_event_add_dropbox_handler(&region->runtime->handlers,
                               WM_dropboxmap_find("Outliner", SPACE_OUTLINER, RGN_TYPE_WINDOW));
}

/* A region's scroll-bars fade in as the mouse nears them, and show fully over them. blender-port: screen_ops.cc
 * area_actionzone_get_rect and area_actionzone_refresh_xy for the region's AZONE_REGION_SCROLL zones, which Bylonder's
 * areas do not have. (x, y): the mouse in region pixels, outside the region once it left. Returns whether they changed. */
EXPORT(region_scrollers_hover) bool region_scrollers_hover(ARegion *region, int x, int y)
{
  View2D *v2d = &region->v2d;
  const char before[2] = {v2d->alpha_vert, v2d->alpha_hor};
  const int xy[2] = {region->winrct.xmin + x, region->winrct.ymin + y};
  int scroll_flag = 0;
  const char isect = ui::view2d_mouse_in_scrollers_ex(region, v2d, xy, &scroll_flag);
  const int edge_padding = int(-3.0f * UI_SCALE_FAC);
  const auto alpha = [&](const rcti &bar, const bool vertical) {
    const bool is_right = vertical && (v2d->scroll & V2D_SCROLL_RIGHT), is_left = vertical && (v2d->scroll & V2D_SCROLL_LEFT);
    const bool is_top = !vertical && (v2d->scroll & V2D_SCROLL_TOP), is_bottom = !vertical && (v2d->scroll & V2D_SCROLL_BOTTOM);
    const rcti zone = {bar.xmin - (is_right ? int(V2D_SCROLL_HIDE_HEIGHT) : edge_padding),
                       bar.xmax + (is_left ? int(V2D_SCROLL_HIDE_HEIGHT) : edge_padding),
                       bar.ymin - (is_top ? int(V2D_SCROLL_HIDE_WIDTH) : edge_padding),
                       bar.ymax + (is_bottom ? int(V2D_SCROLL_HIDE_WIDTH) : edge_padding)};
    if (!BLI_rcti_isect_pt(&zone, x, y)) {
      return char(0);
    }
    if (isect == (vertical ? 'v' : 'h')) {
      return char(255);
    }
    const float dist_fac = vertical ? BLI_rcti_length_x(&bar, x) / V2D_SCROLL_HIDE_HEIGHT : BLI_rcti_length_y(&bar, y) / V2D_SCROLL_HIDE_WIDTH;
    return char((1.0f - std::clamp(dist_fac, 0.0f, 1.0f)) * 255);
  };
  v2d->alpha_vert = (scroll_flag & V2D_SCROLL_VERTICAL) ? alpha(v2d->vert, true) : 0;
  v2d->alpha_hor = (scroll_flag & V2D_SCROLL_HORIZONTAL) ? alpha(v2d->hor, false) : 0;
  return before[0] != v2d->alpha_vert || before[1] != v2d->alpha_hor;
}

/* Marks the Outliner for a sync of its selection from the view layer's, as the editors that change the selection do
 * (ED_outliner_select_sync_from_object_tag). */
EXPORT(outliner_select_sync_from_objects) void outliner_select_sync_from_objects(ScrArea *area)
{
  space(area)->sync_select_dirty |= WM_OUTLINER_SYNC_SELECT_FROM_OBJECT;
}

namespace blender {

/* As screen_ops.cc defines them. */
bool ED_operator_outliner_active(bContext *C)
{
  const SpaceLink *sl = static_cast<SpaceLink *>(CTX_wm_space_data(C));
  return ED_operator_areaactive(C) && sl && sl->spacetype == SPACE_OUTLINER;
}
bool ED_operator_region_outliner_active(bContext *C)
{
  if (!ED_operator_outliner_active(C)) {
    CTX_wm_operator_poll_msg_set(C, "Expected an active Outliner");
    return false;
  }
  const ARegion *region = CTX_wm_region(C);
  if (!(region && region->regiontype == RGN_TYPE_WINDOW)) {
    CTX_wm_operator_poll_msg_set(C, "Expected an Outliner region");
    return false;
  }
  return true;
}

}  // namespace blender
