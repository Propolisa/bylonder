/* The render result of an engine Blender renders with in the module (Cycles, src/editors/render/cycles-source.js): its
 * size and its pixels through the scene's view transform, as Blender's render window shows them. */

#include "DNA_scene_types.h"
#include "RE_pipeline.h"

#include <cstdint>

using namespace blender;

#define EXPORT(name) extern "C" __attribute__((export_name(#name)))

/* The width and height of the scene's last render result, in `r_size`; false when it has none. */
EXPORT(render_result_size) bool render_result_size(const Scene *scene, int *r_size)
{
  Render *re = RE_GetSceneRender(scene);
  if (!re) {
    return false;
  }
  RenderResult result;
  RE_AcquireResultImage(re, &result, 0);
  r_size[0] = result.rectx;
  r_size[1] = result.recty;
  RE_ReleaseResultImage(re);
  return r_size[0] > 0 && r_size[1] > 0;
}

/* Its pixels as 8-bit RGBA in display space, bottom row first, into `dst` (width * height * 4 bytes). */
EXPORT(render_result_pixels) void render_result_pixels(const Scene *scene, uint8_t *dst)
{
  RE_ResultGet32(RE_GetSceneRender(scene), dst);
}
