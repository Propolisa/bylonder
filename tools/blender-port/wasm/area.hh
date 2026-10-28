/* An area Bylonder's window manager lays out (an animation editor's, Edit Mode's 3D View), with the text its operators
 * show in its header (ED_area_status_text), which JS reads. */
#pragma once

#include "DNA_screen_types.h"

#include <string>

struct BylonderArea {
  blender::ScrArea area = {};
  std::string status;
};
