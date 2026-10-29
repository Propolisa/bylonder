/* The scene module's object for modifier stacks evaluated apart from the scene (bmesh.wasm): a mesh object in a Main
 * of its own, with one scene, its mesh from arrays and its stack evaluated by Blender's depsgraph, as a viewport's. */
#include "BKE_collection.hh"
#include "BKE_layer.hh"
#include "BKE_lib_id.hh"
#include "BKE_main.hh"
#include "BKE_mesh.hh"
#include "BKE_object.hh"
#include "BKE_scene.hh"
#include "DEG_depsgraph.hh"
#include "DEG_depsgraph_build.hh"
#include "DEG_depsgraph_query.hh"
#include "DNA_mesh_types.h"
#include "DNA_object_types.h"
#include "DNA_scene_types.h"
#include "MEM_guardedalloc.h"

#include "extraction.hh"

using namespace blender;

#define EXPORT(name) extern "C" __attribute__((export_name(#name)))

void types_ensure();

struct ModifierObject {
  Main *bmain;
  Scene *scene;
  ViewLayer *view_layer;
  Object *object;
  ExtractionHeader header = {};
};

EXPORT(modifier_object_new) ModifierObject *modifier_object_new()
{
  types_ensure();
  ModifierObject *mo = MEM_new<ModifierObject>(__func__);
  mo->bmain = BKE_main_new();
  mo->scene = BKE_scene_add(mo->bmain, "Scene");
  mo->view_layer = BKE_view_layer_default_view(mo->scene);
  mo->object = BKE_object_add_only_object(mo->bmain, OB_MESH, "Object");
  mo->object->data = static_cast<ID *>(BKE_object_obdata_add_from_type(mo->bmain, OB_MESH, "Mesh"));
  BKE_collection_object_add(mo->bmain, mo->scene->master_collection, mo->object);
  return mo;
}

EXPORT(modifier_object_free) void modifier_object_free(ModifierObject *mo)
{
  BKE_main_free(mo->bmain);
  MEM_delete(mo);
}

EXPORT(modifier_object_mesh_set)
void modifier_object_mesh_set(ModifierObject *mo, int verts_num, const float3 *positions, int edges_num, const int2 *edges, int faces_num,
                              const int *face_offsets, const int *corner_verts, const int *corner_edges, const float2 *uvs)
{
  Mesh *mesh = mesh_from_arrays(verts_num, positions, edges_num, edges, faces_num, face_offsets, corner_verts, corner_edges, uvs);
  BKE_mesh_nomain_to_mesh(mesh, id_cast<Mesh *>(mo->object->data), mo->object);
}

EXPORT(modifier_object) Object *modifier_object(ModifierObject *mo) { return mo->object; }

/* Evaluates the stack as the viewport does and extracts the result, which stays until the next evaluation. Its
 * modifiers may have changed in any way since the last, which change the graph's relations too. */
EXPORT(modifier_object_eval) const ExtractionHeader *modifier_object_eval(ModifierObject *mo)
{
  DEG_relations_tag_update(mo->bmain);
  DEG_id_tag_update_ex(mo->bmain, &mo->object->id, ID_RECALC_GEOMETRY);
  Depsgraph *depsgraph = BKE_scene_ensure_depsgraph(mo->bmain, mo->scene, mo->view_layer);
  BKE_scene_graph_update_tagged(depsgraph, mo->bmain);
  const Object *evaluated = DEG_get_evaluated(depsgraph, mo->object);
  mesh_extraction(*BKE_object_get_evaluated_mesh(evaluated), mo->header);
  return &mo->header;
}
