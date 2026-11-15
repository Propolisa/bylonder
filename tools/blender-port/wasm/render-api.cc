/* F12 with an engine Blender renders in the module (Cycles, src/editors/render/cycles-source.js): Blender's own render
 * job, its progress, and its result's size and pixels through the scene's view transform, as Blender's render window
 * shows them. */

#include "BKE_context.hh"
#include "DNA_scene_types.h"
#include "RE_pipeline.h"
#include "WM_api.hh"

#include <algorithm>
#include <cstdint>
#include <unordered_set>

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

#define JOBS_GET _ZN7blender11WM_jobs_getEPNS_15wmWindowManagerEPNS_8wmWindowEPKvPKcNS_11eWM_JobFlagENS_11eWM_JobTypeE
/* port-override: window-manager jobs of these types run on threads of their own as in Blender, so the page goes on
 * while they work (platform.cc); the others run on the page's thread, where their subsystems wait for them (asset
 * lists, the File Browser). WM_jobs_get, linked with --wrap, notes which jobs they are. */
static constexpr eWM_JobType OWN_THREAD_JOBS[] = {WM_JOB_TYPE_RENDER, WM_JOB_TYPE_RENDER_PREVIEW};
static std::unordered_set<const void *> own_thread_jobs;
extern "C" wmJob *WRAP(__real_, JOBS_GET)(wmWindowManager *wm, wmWindow *win, const void *owner, const char *name,
                                          eWM_JobFlag flag, eWM_JobType job_type);
extern "C" wmJob *WRAP(__wrap_, JOBS_GET)(wmWindowManager *wm, wmWindow *win, const void *owner, const char *name,
                                          eWM_JobFlag flag, eWM_JobType job_type)
{
  wmJob *job = WRAP(__real_, JOBS_GET)(wm, win, owner, name, flag, job_type);
  if (std::find(std::begin(OWN_THREAD_JOBS), std::end(OWN_THREAD_JOBS), job_type) != std::end(OWN_THREAD_JOBS)) {
    own_thread_jobs.insert(job);
  }
  else {
    own_thread_jobs.erase(job);
  }
  return job;
}
extern "C" bool job_on_own_thread(const void *callerdata)
{
  return own_thread_jobs.contains(callerdata);
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
