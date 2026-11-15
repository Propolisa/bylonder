/* F12 with an engine Blender renders in the module (Cycles, src/editors/render/cycles-source.js): Blender's own render
 * job, its progress, and its result's size and pixels through the scene's view transform, as Blender's render window
 * shows them. */

#include "BKE_context.hh"
#include "DNA_scene_types.h"
#include "RE_pipeline.h"
#include "WM_api.hh"

#include <cstdint>

using namespace blender;

#define EXPORT(name) extern "C" __attribute__((export_name(#name)))

#define RENDER_VIEW_OPEN _ZN7blender16render_view_openEPNS_8bContextEiiPNS_10ReportListE
#define WRAP_(prefix, name) prefix##name
#define WRAP(prefix, name) WRAP_(prefix, name)
/* port-override: the page shows a render in its own Render Result window (editors/render/host.js), so F12 opens no
 * Image Editor area or window, as with the Preferences' Render In set to Keep User Interface. */
extern "C" ScrArea *WRAP(__wrap_, RENDER_VIEW_OPEN)(bContext * /*C*/, int /*mx*/, int /*my*/, ReportList * /*reports*/)
{
  return nullptr;
}

extern bool platform_threaded_jobs;
/* F12's render job (render.render's invoke, which the page runs between these) on a thread of its own: platform.cc
 * runs other window-manager jobs on the page's thread. */
EXPORT(render_job_start) void render_job_start(bool starting)
{
  platform_threaded_jobs = starting;
}

/* Whether the scene's render job runs (render.render's invoke started it), and how far it is (0 to 1). */
EXPORT(render_job_running) bool render_job_running(const bContext *C, const Scene *scene)
{
  return WM_jobs_test(CTX_wm_manager(C), scene, WM_JOB_TYPE_RENDER);
}
EXPORT(render_job_progress) float render_job_progress(const bContext *C, const Scene *scene)
{
  return WM_jobs_progress(CTX_wm_manager(C), scene);
}
/* Stops it, as Esc does in Blender's render window. */
EXPORT(render_job_stop) void render_job_stop(const bContext *C, const Scene *scene)
{
  WM_jobs_stop_type(CTX_wm_manager(C), scene, WM_JOB_TYPE_RENDER);
}

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
