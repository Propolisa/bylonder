/* What the view (src/blenkernel/main-view.js) reads of Main besides RNA's values and the extracted geometry: a Mesh's
 * attributes, so a mesh is drawn whole whoever made it (Bylonder, a read file or an undo step); and Main evaluated
 * for a frame, as the depsgraph evaluates a new frame, for the view to draw. */
#include "BKE_anim_data.hh"
#include "BKE_animsys.h"
#include "BKE_attribute.hh"
#include "BKE_context.hh"
#include "BKE_lib_query.hh"
#include "BKE_main.hh"
#include "BKE_mesh.hh"
#include "BKE_scene.hh"
#include "DNA_mesh_types.h"
#include "DNA_object_types.h"
#include "DNA_scene_types.h"

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
