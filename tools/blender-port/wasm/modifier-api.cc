/* Blender's modifier stack on an object outside Edit Mode: the object's mesh comes in as arrays, its modifiers are
 * Blender's ModifierData (JS writes their settings at the offsets of their DNA structs), and mesh_create_eval_final
 * evaluates them as the depsgraph would. The result's arrays are read in place through an ExtractionHeader. */
#include "BKE_attribute.hh"
#include "BKE_node.hh"
#include "BKE_cpp_types.hh"
#include "BKE_customdata.hh"
#include "BKE_idtype.hh"
#include "BKE_lib_id.hh"
#include "BKE_mesh.h"
#include "BKE_mesh.hh"
#include "BKE_mesh_runtime.hh"
#include "BKE_mesh_wrapper.hh"
#include "BKE_modifier.hh"
#include "BKE_object_types.hh"
#include "BKE_scene.hh"
#include "BLI_listbase.h"
#include "BLI_math_base.h"
#include "BLI_time.h"
#include "BLO_readfile.hh"
#include "BLT_translation.hh"
#include "DEG_depsgraph.hh"
#include "DNA_armature_types.h"
#include "DNA_image_types.h"
#include "DNA_mesh_types.h"
#include "DNA_modifier_types.h"
#include "DNA_object_types.h"
#include "DNA_scene_types.h"
#include "DNA_sound_types.h"
#include "DNA_windowmanager_types.h"
#include "GPU_platform_backend_enum.h"
#include "MEM_guardedalloc.h"
#include "NOD_shader.h"

#include "extraction.hh"

#include <ctime>

using namespace blender;

#define EXPORT(name) extern "C" __attribute__((export_name(#name)))

/* As Blender's main sets them up before any data is made, once, on first use: other files' statics they reach are not
 * constructed yet while the module initializes. */
void fonts_init();
void types_ensure()
{
  static const bool types = (BKE_cpp_types_init(), BKE_idtype_init(), BKE_modifier_init(), fonts_init(), true);
  (void)types;
}

struct ModifierObject {
  Scene scene = {};
  Object object = {};
  Mesh *result = nullptr;
  ExtractionHeader header = {};
};

static Mesh *&object_mesh(ModifierObject &mo) { return reinterpret_cast<Mesh *&>(mo.object.data); }

/* As BKE_object_free_modifiers frees a mesh object's. */
static void modifiers_free(Object &ob)
{
  while (ModifierData *md = static_cast<ModifierData *>(BLI_pophead(&ob.modifiers))) {
    BKE_modifier_free(md);
  }
}

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
  const int corners_num = face_offsets[faces_num];
  Mesh *mesh = BKE_mesh_new_nomain(verts_num, edges_num, faces_num, corners_num);
  mesh->vert_positions_for_write().copy_from({positions, verts_num});
  mesh->edges_for_write().copy_from({edges, edges_num});
  mesh->face_offsets_for_write().copy_from({face_offsets, faces_num + 1});
  mesh->corner_verts_for_write().copy_from({corner_verts, corners_num});
  mesh->corner_edges_for_write().copy_from({corner_edges, corners_num});
  if (uvs) {
    mesh->attributes_for_write().add<float2>("UVMap", bke::AttrDomain::Corner,
                                             bke::AttributeInitVArray(VArray<float2>::from_span({uvs, corners_num})));
    mesh->uv_maps_active_set("UVMap");
    mesh->uv_maps_default_set("UVMap");
  }
  if (object_mesh(*mo)) {
    BKE_id_free(nullptr, object_mesh(*mo));
  }
  object_mesh(*mo) = mesh;
}

EXPORT(modifier_object) Object *modifier_object(ModifierObject *mo) { return &mo->object; }

/* A modifier of a type (ModifierType) with Blender's defaults, last in an object's stack. */
EXPORT(modifier_add) ModifierData *modifier_add(Object *ob, int type)
{
  types_ensure();
  if (!BKE_modifier_get_info(ModifierType(type))) {
    return nullptr;
  }
  ModifierData *md = BKE_modifier_new(type);
  BLI_addtail(&ob->modifiers, md);
  /* As ED_object_modifier_add gives a mesh its skin vertices when a Skin modifier is added. */
  if (type == eModifierType_Skin) {
    BKE_mesh_ensure_skin_customdata(id_cast<Mesh *>(ob->data));
  }
  return md;
}

EXPORT(modifier_clear) void modifier_clear(Object *ob) { modifiers_free(*ob); }

/* What the modifier reported in its last evaluation (BKE_modifier_set_error), or null. */
EXPORT(modifier_error) const char *modifier_error(const ModifierData *md) { return md->error; }

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

/* Subdivision Surface last in the stack defers to the wrapper, which holds the subdivided mesh. */
void blender::mesh_extraction(const Mesh &evaluated, ExtractionHeader &h)
{
  const Mesh *mesh = BKE_mesh_wrapper_ensure_subdivision(&evaluated);
  BKE_mesh_wrapper_ensure_mdata(const_cast<Mesh *>(mesh));
  h = {};
  h.verts_num = mesh->verts_num;
  h.edges_num = mesh->edges_num;
  h.faces_num = mesh->faces_num;
  h.corners_num = mesh->corners_num;
  h.tris_num = mesh->corner_tris().size();
  h.positions = reinterpret_cast<float(*)[3]>(const_cast<float3 *>(mesh->vert_positions().data()));
  h.vert_normals = reinterpret_cast<float(*)[3]>(const_cast<float3 *>(mesh->vert_normals().data()));
  h.face_normals = reinterpret_cast<float(*)[3]>(const_cast<float3 *>(mesh->face_normals().data()));
  h.edges = reinterpret_cast<int(*)[2]>(const_cast<int2 *>(mesh->edges().data()));
  h.face_offsets = const_cast<int *>(mesh->face_offsets().data());
  h.corner_verts = const_cast<int *>(mesh->corner_verts().data());
  h.corner_edges = const_cast<int *>(mesh->corner_edges().data());
  h.corner_tris = reinterpret_cast<int(*)[3]>(const_cast<int3 *>(mesh->corner_tris().data()));
  h.tri_faces = const_cast<int *>(mesh->corner_tri_faces().data());
  h.orig_index[0] = static_cast<const int *>(CustomData_get_layer(&mesh->vert_data, CD_ORIGINDEX));
  h.orig_index[1] = static_cast<const int *>(CustomData_get_layer(&mesh->edge_data, CD_ORIGINDEX));
  h.orig_index[2] = static_cast<const int *>(CustomData_get_layer(&mesh->face_data, CD_ORIGINDEX));
  const VArray<float2> uvs = *mesh->attributes().lookup<float2>(mesh->active_or_default_uv_map_name(), bke::AttrDomain::Corner);
  if (uvs && uvs.is_span()) {
    h.uvs = reinterpret_cast<float(*)[2]>(const_cast<float2 *>(uvs.get_internal_span().data()));
  }
}

/* A Mesh of positions and faces whose edges Blender derives, as a script's mesh.update() does (rna_Mesh_update), read
 * through the header until the next call. */
EXPORT(mesh_from_faces)
const ExtractionHeader *mesh_from_faces(int verts_num, const float3 *positions, int faces_num, const int *face_offsets, const int *corner_verts)
{
  types_ensure();
  static Mesh *mesh = nullptr;
  static ExtractionHeader header;
  if (mesh) {
    BKE_id_free(nullptr, mesh);
  }
  const int corners_num = face_offsets[faces_num];
  mesh = BKE_mesh_new_nomain(verts_num, 0, faces_num, corners_num);
  mesh->vert_positions_for_write().copy_from({positions, verts_num});
  mesh->face_offsets_for_write().copy_from({face_offsets, faces_num + 1});
  mesh->corner_verts_for_write().copy_from({corner_verts, corners_num});
  bke::mesh_calc_edges(*mesh, false, true);
  mesh_extraction(*mesh, header);
  return &header;
}

/* What the modifiers reach of Blender beyond the module. */

namespace blender {

/* Modifier types the module leaves out (Geometry Nodes needs file streams, Line Art Grease Pencil): an empty name makes
 * BKE_modifier_get_info treat them as unknown. */
ModifierTypeInfo modifierType_Nodes = {};
ModifierTypeInfo modifierType_GreasePencilLineart = {};

/* port-override: no GPU in the module, so subdivision is evaluated on the CPU. */
GPUBackendType GPU_backend_get_type() { return GPU_BACKEND_NONE; }

int64_t BLI_time_now_seconds_i() { return int64_t(time(nullptr)); }
double BLI_time_now_seconds()
{
  timespec ts;
  clock_gettime(CLOCK_MONOTONIC, &ts);
  return ts.tv_sec + ts.tv_nsec * 1e-9;
}

/* As readfile.cc defines them for data not read from a file, which is all the module's data. */
ID_Readfile_Data::Tags BLO_readfile_id_runtime_tags(const ID & /*id*/) { return {}; }
void BLO_readfile_id_runtime_data_free(ID & /*id*/) {}

/* As scene.cc defines them; scene.cc comes with Blender's scenes, which the module's one scene does without. */
int get_render_subsurf_level(const RenderData *r, int lvl, bool for_render)
{
  if (r->mode & R_SIMPLIFY) {
    return for_render ? min_ii(r->simplify_subsurf_render, lvl) : min_ii(r->simplify_subsurf, lvl);
  }
  return lvl;
}
float BKE_scene_ctime_get(const Scene *scene) { return (scene->r.cfra + scene->r.subframe) * scene->r.framelen; }


/* An ID type whose source the module does not build: Main never holds one of it (the module makes none and reads no
 * files), so it has only what Blender's tables of ID types list, and no callbacks. modifiers-only.cc has more. */
IDTypeInfo id_type_without_data(short code, uint64_t filter, int index, size_t size, const char *name,
                                       const char *name_plural, const char *context, uint32_t flags)
{
  IDTypeInfo info;
  info.id_code = code;
  info.id_filter = filter;
  info.main_listbase_index = index;
  info.struct_size = size;
  info.name = name;
  info.name_plural = name_plural;
  info.translation_context = context;
  info.flags = flags;
  info.asset_type_info = nullptr;
  info.init_data = nullptr;
  info.copy_data = nullptr;
  info.free_data = nullptr;
  info.make_local = nullptr;
  info.foreach_id = nullptr;
  info.foreach_cache = nullptr;
  info.foreach_path = nullptr;
  info.foreach_working_space_color = nullptr;
  info.owner_pointer_get = nullptr;
  info.blend_write = nullptr;
  info.blend_read_data = nullptr;
  info.blend_read_after_liblink = nullptr;
  info.blend_read_undo_preserve = nullptr;
  info.lib_override_apply_post = nullptr;
  return info;
}

IDTypeInfo IDType_ID_IM = id_type_without_data(ID_IM, FILTER_ID_IM, INDEX_ID_IM, sizeof(Image), "Image", "images",
                                               BLT_I18NCONTEXT_ID_IMAGE, IDTYPE_FLAGS_NO_ANIMDATA | IDTYPE_FLAGS_APPEND_IS_REUSABLE);
IDTypeInfo IDType_ID_SO = id_type_without_data(ID_SO, FILTER_ID_SO, INDEX_ID_SO, sizeof(bSound), "Sound", "sounds",
                                               BLT_I18NCONTEXT_ID_SOUND, IDTYPE_FLAGS_NO_ANIMDATA | IDTYPE_FLAGS_APPEND_IS_REUSABLE);
IDTypeInfo IDType_ID_AR = id_type_without_data(ID_AR, FILTER_ID_AR, INDEX_ID_AR, sizeof(bArmature), "Armature", "armatures",
                                               BLT_I18NCONTEXT_ID_ARMATURE, IDTYPE_FLAGS_APPEND_IS_REUSABLE);
/* The module's one window manager is its context's, outside Main. */
IDTypeInfo IDType_ID_WM = id_type_without_data(ID_WM, FILTER_ID_WM, INDEX_ID_WM, sizeof(wmWindowManager), "WindowManager",
                                               "window_managers", BLT_I18NCONTEXT_ID_WINDOWMANAGER,
                                               IDTYPE_FLAGS_NO_COPY | IDTYPE_FLAGS_NO_LIBLINKING | IDTYPE_FLAGS_NO_ANIMDATA |
                                                   IDTYPE_FLAGS_NO_MEMFILE_UNDO | IDTYPE_FLAGS_NEVER_UNUSED);

/* As node_shader_tree.cc registers it, its identifiers only: the module has no shader nodes, and a new World's tree
 * (world.cc) is named by it. */
static bke::bNodeTreeType *shader_tree_type()
{
  static bke::bNodeTreeType type;
  type.type = NTREE_SHADER;
  type.idname = UString("ShaderNodeTree");
  type.group_idname = UString("ShaderNodeGroup");
  return &type;
}
bke::bNodeTreeType *ntreeType_Shader = shader_tree_type();

}  // namespace blender
