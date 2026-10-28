/* What the 3D View's operators reach of the 3D View beyond view3d_project.cc, whose space, drawing and navigation stay
 * in JS: its view (RegionView3D) is the one edit_context_view_set gives, without clipping planes. */
#include "BLI_math_matrix.h"
#include "BLI_math_vector.h"

#include "GPU_matrix.hh"

#include "BKE_scene.hh"

#include "DNA_scene_types.h"
#include "DNA_userdef_types.h"
#include "DNA_screen_types.h"
#include "DNA_view3d_types.h"

#include "ED_screen.hh"
#include "ED_view3d.hh"

namespace blender {

/* As space_view3d.cc defines it. */
void ED_view3d_init_mats_rv3d(const Object *ob, RegionView3D *rv3d)
{
  mul_m4_m4m4(rv3d->viewmatob, rv3d->viewmat, ob->object_to_world().ptr());
  mul_m4_m4m4(rv3d->persmatob, rv3d->persmat, ob->object_to_world().ptr());
}

/* As view3d_select.cc defines it. */
float ED_view3d_select_dist_px() { return 75.0f * U.pixelsize; }

/* port-override: the view has no clipping planes (Alt B), so no point is clipped. */
bool ED_view3d_clipping_test(const RegionView3D * /*rv3d*/, const float /*co*/[3], const bool /*is_local*/) { return false; }

/* port-override: the view's clip range as BKE_camera_params_from_view3d gives it for a view without a camera. */
bool ED_view3d_clip_range_get(const Depsgraph * /*depsgraph*/, const View3D *v3d, const RegionView3D *rv3d, const bool use_ortho_factor,
                              float *r_clip_start, float *r_clip_end)
{
  const bool is_ortho = !rv3d->is_persp;
  float clip_start = is_ortho ? -v3d->clip_end * 0.5f : v3d->clip_start;
  float clip_end = is_ortho ? v3d->clip_end * 0.5f : v3d->clip_end;
  if (use_ortho_factor && is_ortho) {
    const float fac = 2.0f / (clip_end - clip_start);
    clip_start *= fac;
    clip_end *= fac;
  }
  if (r_clip_start) {
    *r_clip_start = clip_start;
  }
  if (r_clip_end) {
    *r_clip_end = clip_end;
  }
  return is_ortho;
}

/* As view3d_draw.cc defines them, without the finer steps of orthographic axis views. */
float ED_view3d_grid_scale(const Scene *scene, const View3D *v3d, const char **r_grid_unit)
{
  return v3d->grid * ED_scene_grid_scale(scene, r_grid_unit);
}
float ED_view3d_grid_view_scale(const Scene *scene, const View3D *v3d, const ARegion * /*region*/, const char **r_grid_unit)
{
  return ED_view3d_grid_scale(scene, v3d, r_grid_unit);
}

/* No GPU: depth reads are Bylonder's picking (JS). */
void view3d_operator_needs_gpu(const bContext * /*C*/) {}

/* port-override: playback is Bylonder's (JS), so no screen plays an animation timer here. */
bScreen *ED_screen_animation_playing(const wmWindowManager * /*wm*/) { return nullptr; }

/* As gpu_matrix.cc defines them; the rest of that file keeps the GPU's matrix stack, which the module has none of. */
void GPU_matrix_project_3fv(const float world[3], const float model[4][4], const float proj[4][4], const int view[4], float r_win[3])
{
  float v[4];
  mul_v4_m4v3(v, model, world);
  mul_m4_v4(proj, v);
  if (v[3] != 0.0f) {
    mul_v3_fl(v, 1.0f / v[3]);
  }
  r_win[0] = view[0] + (view[2] * (v[0] + 1)) * 0.5f;
  r_win[1] = view[1] + (view[3] * (v[1] + 1)) * 0.5f;
  r_win[2] = (v[2] + 1) * 0.5f;
}
bool GPU_matrix_unproject_3fv(const float win[3], const float model_inverted[4][4], const float proj[4][4], const int view[4], float r_world[3])
{
  zero_v3(r_world);
  const float in[3] = {
      2 * ((win[0] - view[0]) / view[2]) - 1.0f,
      2 * ((win[1] - view[1]) / view[3]) - 1.0f,
      2 * win[2] - 1.0f,
  };
  float out[3];
  const bool is_persp = proj[3][3] == 0.0f;
  if (is_persp) {
    out[2] = proj[3][2] / (proj[2][2] + in[2]);
    if (isinf(out[2])) {
      out[2] = FLT_MAX;
    }
    out[0] = out[2] * ((proj[2][0] + in[0]) / proj[0][0]);
    out[1] = out[2] * ((proj[2][1] + in[1]) / proj[1][1]);
    out[2] *= -1;
  }
  else {
    out[0] = (-proj[3][0] + in[0]) / proj[0][0];
    out[1] = (-proj[3][1] + in[1]) / proj[1][1];
    out[2] = (-proj[3][2] + in[2]) / proj[2][2];
  }
  if (!is_finite_v3(out)) {
    return false;
  }
  mul_v3_m4v3(r_world, model_inverted, out);
  return true;
}

}  // namespace blender
