/* Blender's GPU selection (view3d_gpu_select_ex: box select, the clicks and picks of bones) without a GPU: Blender's own
 * gpu_select.cc and gpu_select_next.cc, compiled here as they are, keep the selection's state and results, and the draw
 * loop that would render each object's select ids into the selection rectangle is a seam answering from what the
 * overlay draws of armatures in Edit and Pose Mode (armature-draw.cc armature_select_hits). Other objects draw no select
 * ids here: a mesh's faces, curves' points and the rest would need their own drawn parts. The seams are defined by
 * qualified name, so one whose signature differs from Blender's declaration fails to compile. */
#include "BKE_layer.hh"
#include "BKE_object_types.hh"
#include "BLI_listbase_iterator.hh"
#include "BLI_rect.h"
#include "BLI_vector.hh"
#include "DEG_depsgraph_query.hh"
#include "DNA_layer_types.h"
#include "DNA_object_types.h"
#include "DNA_scene_types.h"
#include "DNA_screen_types.h"
#include "DNA_view3d_types.h"
#include "DRW_engine.hh"
#include "GPU_matrix.hh"
#include "GPU_select.hh"
#include "GPU_state.hh"

#include <algorithm>
#include <cstring>
#include <utility>

#include "intern/gpu_select.cc"
#include "intern/gpu_select_next.cc"

void view3d_matrices_restore(blender::RegionView3D &rv3d);

namespace blender {

/* A part of an armature the overlay draws inside a region of the view: its select id (the object's | the bone's index
 * << 16 | BONESEL_*), the nearest depth it is drawn at (0 to 1) and its distance in pixels to the region's center. */
struct SelectHit {
  uint id;
  float depth;
  float distance;
};
void armature_select_hits(Depsgraph *depsgraph, Object *ob, const RegionView3D &rv3d, int winx, int winy, const rcti &rect, int radius,
                          Vector<SelectHit> &hits);

/* The view whose matrices view3d_gpu_select_ex set up for its rectangle, given back once it is done. */
static RegionView3D *selecting_view = nullptr;

/* Each hit as the select engine reads its result back (select_instance.hh read_result, select_lib.glsl): every id drawn
 * for GPU_SELECT_ALL, its nearest depth for PICK_ALL, and for PICK_NEAREST the one nearest in depth then to the cursor. */
static Vector<GPUSelectResult> select_results(const Span<SelectHit> hits, const GPUSelectMode mode)
{
  Vector<GPUSelectResult> results;
  for (const SelectHit &hit : hits) {
    GPUSelectResult result{hit.id, 0xFFFF};
    if (mode == GPU_SELECT_PICK_ALL) {
      std::memcpy(&result.depth, &hit.depth, sizeof(float));
    }
    else if (mode == GPU_SELECT_PICK_NEAREST) {
      result.depth = (uint(hit.depth * float(0x00FFFFFFu)) << 8u) | uint(std::min(hit.distance, 254.0f));
      if (!results.is_empty() && result.depth >= results[0].depth) {
        continue;
      }
      results.clear();
    }
    results.append(result);
  }
  return results;
}

}  // namespace blender

using namespace blender;

/* port-override: the GPU module is past the seam; selection projects by the view's own matrices. */
void blender::DRW_gpu_context_enable() {}
void blender::DRW_gpu_context_disable()
{
  if (selecting_view) {
    view3d_matrices_restore(*std::exchange(selecting_view, nullptr));
  }
}
void blender::GPU_depth_test(GPUDepthTest /*test*/) {}
void blender::GPU_matrix_frustum_set(float /*left*/, float /*right*/, float /*bottom*/, float /*top*/, float /*near*/, float /*far*/) {}

/* port-override: the draw module is past the seam. One selection pass, as DRW_draw_select_loop's with the Select-Next
 * engine: the hits of the armatures in Edit or Pose Mode the object filter lets through, drawn into the rectangle of
 * the view as the browser shows it. */
void blender::DRW_draw_select_loop(Depsgraph *depsgraph, ARegion *region, View3D *v3d, bool /*draw_surface*/, bool /*use_nearest*/,
                                   bool /*do_material_sub_selection*/, const rcti *rect, DRW_SelectPassFn select_pass_fn,
                                   void *select_pass_user_data, DRW_ObjectFilterFn object_filter_fn, void *object_filter_user_data)
{
  RegionView3D &rv3d = *static_cast<RegionView3D *>(region->regiondata);
  selecting_view = &rv3d;
  view3d_matrices_restore(rv3d);
  select_pass_fn(DRW_SELECT_PASS_PRE, select_pass_user_data);
  Vector<SelectHit> hits;
  Scene *scene = DEG_get_input_scene(depsgraph);
  ViewLayer *view_layer = DEG_get_input_view_layer(depsgraph);
  BKE_view_layer_synced_ensure(*DEG_get_bmain(depsgraph), scene, view_layer);
  for (Base &base : *BKE_view_layer_object_bases_get(view_layer)) {
    Object *ob = base.object;
    if (ob->type != OB_ARMATURE || !(ob->mode & (OB_MODE_EDIT | OB_MODE_POSE)) || !BASE_SELECTABLE(v3d, &base)) {
      continue;
    }
    if (object_filter_fn && !object_filter_fn(DEG_get_evaluated(depsgraph, ob), object_filter_user_data)) {
      continue;
    }
    armature_select_hits(depsgraph, ob, rv3d, region->winx, region->winy, *rect, gpu_select_next_get_radius(), hits);
  }
  Vector<GPUSelectResult> results = select_results(hits, gpu_select_next_get_mode());
  gpu_select_next_set_result(results.data(), results.size());
  select_pass_fn(DRW_SELECT_PASS_POST, select_pass_user_data);
}
