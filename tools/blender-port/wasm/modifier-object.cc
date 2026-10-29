/* The modifier kernels module's object (modifiers.wasm): a mesh object outside any Main, its mesh from arrays and its
 * stack evaluated by mesh_create_eval_final on a scene of its own, as the depsgraph would (no-depsgraph.cc). */
#include "BKE_lib_id.hh"
#include "BKE_mesh.hh"
#include "BKE_mesh_runtime.hh"
#include "BKE_object_types.hh"
#include "BKE_scene.hh"
#include "DNA_mesh_types.h"
#include "DNA_object_types.h"
#include "DNA_scene_types.h"
#include "MEM_guardedalloc.h"

#include "extraction.hh"

using namespace blender;

#define EXPORT(name) extern "C" __attribute__((export_name(#name)))

void types_ensure();
void modifiers_free(Object &ob);

struct ModifierObject {
  Scene scene = {};
  Object object = {};
  Mesh *result = nullptr;
  ExtractionHeader header = {};
};

static Mesh *&object_mesh(ModifierObject &mo) { return reinterpret_cast<Mesh *&>(mo.object.data); }

static void result_free(ModifierObject &mo)
{
  if (mo.result) {
    BKE_id_free(nullptr, mo.result);
    mo.result = nullptr;
  }
}

EXPORT(modifier_object_new) ModifierObject *modifier_object_new()
{
  types_ensure();
  ModifierObject *mo = MEM_new<ModifierObject>(__func__);
  mo->object.type = OB_MESH;
  mo->object.runtime = MEM_new<bke::ObjectRuntime>(__func__);
  mo->object.runtime->object_to_world = float4x4::identity();
  mo->object.runtime->world_to_object = float4x4::identity();
  return mo;
}

EXPORT(modifier_object_free) void modifier_object_free(ModifierObject *mo)
{
  result_free(*mo);
  modifiers_free(mo->object);
  if (object_mesh(*mo)) {
    BKE_id_free(nullptr, object_mesh(*mo));
  }
  MEM_delete(mo->object.runtime);
  MEM_delete(mo);
}

/* The object's mesh, from the arrays bm_from_arrays takes; a UV map comes in as Blender's default "UVMap". */
EXPORT(modifier_object_mesh_set)
void modifier_object_mesh_set(ModifierObject *mo, int verts_num, const float3 *positions, int edges_num, const int2 *edges, int faces_num,
                              const int *face_offsets, const int *corner_verts, const int *corner_edges, const float2 *uvs)
{
  Mesh *mesh = mesh_from_arrays(verts_num, positions, edges_num, edges, faces_num, face_offsets, corner_verts, corner_edges, uvs);
  if (object_mesh(*mo)) {
    BKE_id_free(nullptr, object_mesh(*mo));
  }
  object_mesh(*mo) = mesh;
}

EXPORT(modifier_object) Object *modifier_object(ModifierObject *mo) { return &mo->object; }

/* Evaluates the stack as the viewport does and extracts the result, which stays until the next evaluation. */
EXPORT(modifier_object_eval) const ExtractionHeader *modifier_object_eval(ModifierObject *mo)
{
  result_free(*mo);
  Depsgraph *depsgraph = BKE_scene_ensure_depsgraph(nullptr, &mo->scene, nullptr);
  CustomData_MeshMasks mask = CD_MASK_MESH;
  mo->result = bke::mesh_create_eval_final(depsgraph, &mo->scene, &mo->object, &mask);
  mesh_extraction(*mo->result, mo->header);
  return &mo->header;
}
