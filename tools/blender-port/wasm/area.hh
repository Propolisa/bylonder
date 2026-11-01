/* An area the page lays out (wm_area_new's, Edit Mode's 3D View), with the text its operators
 * show in its header (ED_area_status_text), which JS reads. */
#pragma once

#include "BLI_set.hh"
#include "DNA_screen_types.h"

#include <string>

struct BylonderArea {
  blender::ScrArea area = {};
  std::string status;
  /* Whether its first layout has initialized it as ED_area_init does (wm_area_layout). */
  bool initialized = false;
  /* The region types Blender shows by its polls and flags rather than the page's layout (wm_area_regions_shown). */
  blender::Set<int> polled;
};
