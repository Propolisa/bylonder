/* What the view (src/blenkernel/main-view.js) reads of Main besides RNA's values and the extracted geometry: a Mesh's
 * attributes, so a mesh is drawn whole whoever made it (Bylonder, a read file or an undo step). */
#include "BKE_attribute.hh"
#include "BKE_mesh.hh"
#include "DNA_mesh_types.h"
#include "DNA_object_types.h"

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
