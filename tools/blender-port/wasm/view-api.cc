/* What the view (src/blenkernel/main-view.js) reads of Main besides RNA's values and the extracted geometry: a Mesh's
 * attributes, so a mesh is drawn whole whoever made it (Bylonder, a read file or an undo step), an object's edit mesh
 * in Edit Mode, and Main evaluated for a frame, as the depsgraph evaluates a new frame. */
#include "BKE_anim_data.hh"
#include "BKE_animsys.h"
#include "BKE_attribute.hh"
#include "BKE_context.hh"
#include "BKE_editmesh.hh"
#include "BLI_map.hh"
#include "BKE_lib_query.hh"
#include "BKE_main.hh"
#include "BKE_mesh.hh"
#include "BKE_scene.hh"
#include "DNA_mesh_types.h"
#include "DNA_object_types.h"
#include "DNA_scene_types.h"
#include "DNA_view3d_types.h"
#include "extraction.hh"

#include <memory>

#include <string>

using namespace blender;

#define EXPORT(name) extern "C" __attribute__((export_name(#name)))

/* A mesh object's Mesh attributes besides its topology and positions, one per line: name, AttrDomain and AttrType,
 * separated by tabs; valid until the next call. */
EXPORT(mesh_attributes_list) const char *mesh_attributes_list(const Object *ob)
{
  static std::string list;
  list.clear();
  id_cast<const Mesh *>(ob->data)->attributes().foreach_attribute([&](const bke::AttributeIter &iter) {
    if (!ELEM(iter.name, "position", ".edge_verts", ".corner_vert", ".corner_edge")) {
      list += iter.name + "\t" + std::to_string(int(iter.domain)) + "\t" + std::to_string(int(iter.data_type)) + "\n";
    }
  });
  return list.c_str();
}

/* The scene at a frame (BKE_scene_graph_update_for_newframe without a graph to evaluate): the frame set, then every
 * ID's animation and drivers evaluated into it, embedded node trees' included (BKE_animsys_evaluate_animdata), each ID being its own evaluated copy;
 * the objects' matrices follow (main_evaluate). */
EXPORT(view_frame_set) void view_frame_set(bContext *C, float frame)
{
  Main *bmain = CTX_data_main(C);
  Scene *scene = CTX_data_scene(C);
  BKE_scene_frame_set(scene, frame);
  const AnimationEvalContext context = BKE_animsys_eval_context_construct(CTX_data_depsgraph_pointer(C), BKE_scene_ctime_get(scene));
  /* Embedded IDs too (a material's node tree), as the depsgraph has a node for each. */
  BKE_animdata_main_cb(bmain, [&](ID *id, AnimData *adt) {
    BKE_animsys_evaluate_animdata(id, adt, &context, ADT_RECALC_ALL, false);
  });
}

/* An object Main holds in Edit Mode: its edit mesh's arrays as the draw cache extracts them (extraction.hh), the parts
 * that changed (ExtractFlag) refilled, valid until its next extraction; null when it is not in Edit Mode. */
EXPORT(view_edit_mesh_extract) const ExtractionHeader *view_edit_mesh_extract(Object *ob, int what)
{
  static Map<const Object *, std::unique_ptr<Extraction>> extractions;
  BMEditMesh *em = BKE_editmesh_from_object(ob);
  if (!em) {
    extractions.remove(ob);
    return nullptr;
  }
  Extraction &extraction = *extractions.lookup_or_add_cb(ob, [] { return std::make_unique<Extraction>(); });
  extraction_update(em->bm, extraction, what);
  return &extraction.header;
}
/* Its select mode (SCE_SELECT_*), as its overlay draws it. */
EXPORT(view_edit_mesh_selectmode) int view_edit_mesh_selectmode(Object *ob) { return BKE_editmesh_from_object(ob)->selectmode; }

/* port-override: the module has no GPU select buffer (DRW_select_buffer_*), so the 3D View in the context picks and
 * selects regions of an edit mesh as Blender does in X-ray, through the view's projection of each element
 * (mesh_foreachScreenVert and the rest), without occlusion. */
EXPORT(view_xray_picking) void view_xray_picking(bContext *C)
{
  if (View3D *v3d = CTX_wm_view3d(C)) {
    v3d->shading.flag |= V3D_SHADING_XRAY | V3D_SHADING_XRAY_WIREFRAME;
  }
}

namespace blender {
/* port-override: the GPU module is past the seam (the browser draws), so an operator that sets the region's viewport
 * and matrices before it projects (view3d_operator_needs_gpu) has none to set: it projects by the view's own. */
void wmViewport(const rcti * /*winrct*/) {}
void GPU_matrix_projection_set(const float (*/*m*/)[4]) {}
void GPU_matrix_set(const float (*/*m*/)[4]) {}
}  // namespace blender
