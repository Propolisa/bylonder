/* The Outliner: a ScrArea whose SpaceOutliner and regions are Blender's (made by the space type's own create), whose
 * tree Blender's own code builds, draws, selects and edits (editors/space_outliner) over the module's Main. Its main
 * region draws through region-draw.cc; its operators run in its context (outliner_context_set) by editor-context's
 * invoke and exec. */
#include "BKE_context.hh"
#include "BKE_layer.hh"
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
#include "operator-properties.hh"

using namespace blender;

#define EXPORT(name) extern "C" __attribute__((export_name(#name)))

extern "C" void region_draw_begin(int winx, int winy);
extern "C" const char *region_draw_end();

/* The interface's resolution as WM_window_dpi_set_userdef sets it at Blender's default scale of 1, the default theme
 * (userdef_default_theme.c), the default style and the icons. */
static void ui_ensure()
{
  static const bool done = [] {
    U.dpi = 72;
    U.scale_factor = 1.0f;
    U.inv_scale_factor = 1.0f;
    U.pixelsize = 1.0f;
    U.widget_unit = 20;
    ui::theme::init_default();
    ui::style_init_default();
    ui::icons_init();
    return true;
  }();
  (void)done;
}

/* As rna_layer.cc's rna_LayerCollection_exclude_update: excluding sets the collections inside too, and the active
 * object goes when it left the view layer. */
static void layer_collection_exclude_update(bContext *C, PointerRNA *ptr)
{
  LayerCollection *lc = static_cast<LayerCollection *>(ptr->data);
  BKE_layer_collection_set_flag(lc, LAYER_COLLECTION_EXCLUDE, (lc->flag & LAYER_COLLECTION_EXCLUDE) != 0);
  ViewLayer *view_layer = CTX_data_view_layer(C);
  BKE_view_layer_need_resync_tag(view_layer);
  BKE_view_layer_synced_ensure(*CTX_data_main(C), CTX_data_scene(C), view_layer);
  Base *basact = BKE_view_layer_active_base_get(view_layer);
  if (basact && !BKE_view_layer_base_find(view_layer, basact->object)) {
    view_layer->basact = nullptr;
  }
}

/* The Outliner's operators, registered by Blender's own registration function (called by editor-context's operator
 * table), and the update functions of the properties its buttons set. */
void outliner_operatortypes_ensure()
{
  ed::outliner::outliner_operatortypes();
  ui::ED_operatortypes_view2d();
  rna_property_update_set(RNA_LayerCollection, "exclude", layer_collection_exclude_update);
}

static ARegion *main_region(ScrArea *area) { return BKE_area_find_region_type(area, RGN_TYPE_WINDOW); }
static SpaceOutliner *space(ScrArea *area) { return static_cast<SpaceOutliner *>(area->spacedata.first); }

/* An Outliner area, as ED_area_newspace makes one: its space from the space type's create, which also makes its
 * regions. */
EXPORT(outliner_new) ScrArea *outliner_new(bContext *C)
{
  ui_ensure();
  static const bool registered = (ED_spacetype_outliner(), true);
  (void)registered;
  SpaceType *st = BKE_spacetype_from_id(SPACE_OUTLINER);
  ScrArea *area = MEM_new<ScrArea>(__func__);
  area->spacetype = SPACE_OUTLINER;
  area->type = st;
  SpaceLink *sl = st->create(area, CTX_data_scene(C));
  /* port-override: Bylonder's Outliner stands for the one of the file it opens, which syncs its selection from the
   * view layer's only once that changes, rather than for one made at runtime, which syncs at once. */
  reinterpret_cast<SpaceOutliner *>(sl)->sync_select_dirty = 0;
  BLI_addhead(&area->spacedata, sl);
  BLI_movelisttolist(&area->regionbase, &sl->regionbase);
  for (ARegion &region : area->regionbase) {
    region.runtime->type = BKE_regiontype_from_id(st, region.regiontype);
  }
  return area;
}

EXPORT(outliner_space) SpaceOutliner *outliner_space(ScrArea *area) { return space(area); }
EXPORT(outliner_region) ARegion *outliner_region(ScrArea *area) { return main_region(area); }
EXPORT(outliner_region_v2d) View2D *outliner_region_v2d(ScrArea *area) { return &main_region(area)->v2d; }

/* The main region's size in pixels, and its 2D view as outliner_main_region_init sets it up (its keymap and
 * dropboxes are Bylonder's window manager's). */
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
}

/* Makes the Outliner and its main region the context's area and region, as the window manager does for its handlers. */
EXPORT(outliner_context_set) void outliner_context_set(bContext *C, ScrArea *area)
{
  CTX_wm_area_set(C, area);
  CTX_wm_region_set(C, area ? main_region(area) : nullptr);
}

/* Draws the main region as outliner_main_region_draw does, but its overflow indication and scrollbars, which JS draws
 * with the region-draw recording: returns its JSON. */
EXPORT(outliner_draw) const char *outliner_draw(bContext *C, ScrArea *area)
{
  ARegion *region = main_region(area);
  outliner_context_set(C, area);
  region_draw_begin(region->winx, region->winy);
  ui::theme::theme_set(SPACE_OUTLINER, RGN_TYPE_WINDOW);
  ui::theme::frame_buffer_clear(TH_BACK);
  ed::outliner::draw_outliner(C, true);
  ui::view2d_view_restore(C);
  outliner_context_set(C, nullptr);
  return region_draw_end();
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
