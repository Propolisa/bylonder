/* The Outliner: an area of Blender's window (wm_area_new) whose SpaceOutliner and regions are Blender's, whose tree
 * Blender's own code builds, draws, selects and edits (editors/space_outliner) over the module's Main. Its main region
 * draws through wm_region_draw; its operators run in its context (wm_area_context_set) by editor-context's invoke and
 * exec. */
#include "BKE_context.hh"
#include "BKE_layer.hh"
#include "BKE_lib_remap.hh"
#include "BKE_screen.hh"
#include "BLI_listbase.h"
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
 * scale of 1, the default theme (userdef_default_theme.c), the default style and the icons. */
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
  WM_event_add_dropbox_handler(&region->runtime->handlers,
                               WM_dropboxmap_find("Outliner", SPACE_OUTLINER, RGN_TYPE_WINDOW));
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
