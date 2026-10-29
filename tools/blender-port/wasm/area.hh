/* An area the page lays out (wm_area_new's, Edit Mode's 3D View), with the text its operators
 * show in its header (ED_area_status_text), which JS reads. */
#pragma once

#include "DNA_screen_types.h"

#include <string>

struct BylonderArea {
  blender::ScrArea area = {};
  std::string status;
  /* Whether its first layout has initialized it as ED_area_init does (wm_area_layout). */
  bool initialized = false;
};
