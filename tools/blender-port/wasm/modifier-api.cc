/* Blender's modifier stacks: modifiers are Blender's ModifierData (JS writes their settings at the offsets of their DNA
 * structs), on Main's objects or on a module's object of its own (modifier-object.cc, modifier-object-main.cc), whose
 * evaluated mesh is read in place through an ExtractionHeader. */
#include "BKE_attribute.hh"
#include "BKE_blender.hh"
#include "BKE_blendfile.hh"
#include "DNA_userdef_types.h"
#include "BKE_brush.hh"
#include "BKE_callbacks.hh"
#include "BKE_material.hh"
#include "BKE_particle.h"
#include "BKE_shader_fx.hh"
#include "BKE_volume.hh"
#include "BLI_threads.h"
#include "DNA_genfile.h"
#include "FN_init.hh"
#include "IMB_imbuf.hh"
#include "RE_engine.h"
#include "RE_texture.h"
#include "RNA_define.hh"
#include "SEQ_modifier.hh"
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
#include "BLI_map.hh"
#include "BLI_math_base.h"
#include "BLI_time.h"
#include "BLO_read_write.hh"
#include "BLO_readfile.hh"
#include "BLT_translation.hh"
#include "DEG_depsgraph.hh"
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
#include "modifier-standins.hh"

#include <ctime>

using namespace blender;

#define EXPORT(name) extern "C" __attribute__((export_name(#name)))

/* As Blender's main sets them up before any data is made, once, on first use: other files' statics they reach are not
 * constructed yet while the module initializes. */
void fonts_init();
void operators_register();
void ui_init();
void movie_init();

/* The Preferences' add-ons and extension repositories as Blender has them without a userpref.blend
 * (BKE_blendfile_userdef_from_defaults, which WM_init reads), for addon_utils to enable as the scripts load. */
static void addons_init()
{
  UserDef *defaults = BKE_blendfile_userdef_from_defaults();
  BLI_movelisttolist(&U.addons, &defaults->addons);
  BLI_movelisttolist(&U.extension_repos, &defaults->extension_repos);
  BKE_blender_userdef_data_free(defaults, false);
  MEM_delete(defaults);
}

/* What Blender's main initializes (creator.cc), in its order, without the window system and Python. */
static void blender_init()
{
  BLI_threadapi_init();
  DNA_sdna_current_init();
  BKE_blender_globals_init();
  BKE_cpp_types_init();
  fn::multi_function::register_common_functions();
  BKE_idtype_init();
  BKE_modifier_init();
  seq::modifiers_init();
  BKE_shaderfx_init();
  BKE_volumes_init();
  DEG_register_node_types();
  BKE_callback_global_init();
  IMB_init();
  RNA_init();
  movie_init();
  RE_texture_rng_init();
  RE_engines_init();
  bke::node_system_init();
  BKE_brush_system_init();
  BKE_particle_init_rng();
  fonts_init();
  BKE_materials_init();
  ui_init();
  addons_init();
  operators_register();
}

/* The module's initialization: Blender's main's, or a module's own with what its part of Blender needs
 * (modifiers-only.cc). */
__attribute__((weak)) void module_init() { blender_init(); }

void types_ensure()
{
  static const bool types = (module_init(), true);
  (void)types;
}

/* Blender's initialization, which the host runs once after the module's own (_initialize), as Blender's main does
 * before anything else. */
EXPORT(blender_init) void blender_init_export() { types_ensure(); }

/* As BKE_object_free_modifiers frees a mesh object's. */
void modifiers_free(Object &ob)
{
  while (ModifierData *md = static_cast<ModifierData *>(BLI_pophead(&ob.modifiers))) {
    BKE_modifier_free(md);
  }
}

/* A modifier of a type (ModifierType) with Blender's defaults, last in an object's stack. */
EXPORT(modifier_add) ModifierData *modifier_add(Object *ob, int type)
{
  types_ensure();
  const ModifierTypeInfo *info = BKE_modifier_get_info(ModifierType(type));
  if (!info || modifier_is_left_out(info)) {
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

/* An object's modifiers as Main holds them (a read file's), for the scene sync to read: the one at an index (or null),
 * its type (ModifierType), name and mode (ModifierMode: shown in the viewport, in renders). */
EXPORT(object_modifier) ModifierData *object_modifier(Object *ob, int index)
{
  return static_cast<ModifierData *>(BLI_findlink(&ob->modifiers, index));
}
EXPORT(modifier_type) int modifier_type(const ModifierData *md) { return md->type; }
EXPORT(modifier_name) const char *modifier_name(const ModifierData *md) { return md->name; }
EXPORT(modifier_mode) int modifier_mode(const ModifierData *md) { return md->mode; }

/* Evaluates the stack as the viewport does and extracts the result, which stays until the next evaluation. */

Mesh *blender::mesh_from_arrays(int verts_num, const float3 *positions, int edges_num, const int2 *edges, int faces_num,
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
  return mesh;
}

/* Subdivision Surface last in the stack defers to the wrapper, which holds the subdivided mesh. */
const Mesh *blender::extracted_mesh = nullptr;
static Map<const ExtractionHeader *, const float3 *> &corner_normals_of()
{
  static Map<const ExtractionHeader *, const float3 *> map;
  return map;
}

void blender::mesh_extraction(const Mesh &evaluated, ExtractionHeader &h)
{
  const Mesh *mesh = BKE_mesh_wrapper_ensure_subdivision(&evaluated);
  extracted_mesh = mesh;
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
  /* Flat shading's attributes, as Blender draws them; their absence is smooth. One stored as a single value (Shade Flat
   * makes every face sharp) is given as one value per element, kept until the next extraction. */
  static Array<bool> materialized[2];
  int i = 0;
  for (const auto [flag, name, domain] : {std::tuple{SHARP_FACE, "sharp_face", bke::AttrDomain::Face}, std::tuple{SHARP_EDGE, "sharp_edge", bke::AttrDomain::Edge}}) {
    const VArray<bool> values = *mesh->attributes().lookup<bool>(name, domain);
    Array<bool> &kept = materialized[i++];
    if (!values) {
      continue;
    }
    if (values.is_span()) {
      h.flags[flag] = const_cast<bool *>(values.get_internal_span().data());
      continue;
    }
    kept.reinitialize(values.size());
    values.materialize(kept);
    h.flags[flag] = kept.data();
  }
  const VArray<float2> uvs = *mesh->attributes().lookup<float2>(shading_uv_map_name(*mesh), bke::AttrDomain::Corner);
  if (uvs && uvs.is_span()) {
    h.uvs = reinterpret_cast<float(*)[2]>(const_cast<float2 *>(uvs.get_internal_span().data()));
  }
  corner_normals_of().add_overwrite(&h, mesh->normals_domain() == bke::MeshNormalDomain::Corner ? mesh->corner_normals().data() : nullptr);
}

/* The normals per face corner of an extraction's Mesh where Blender draws them so (custom normals, sharp edges:
 * Mesh::normals_domain), or null; apart from the header, whose layout other modules' JS reads. */
EXPORT(extraction_corner_normals) const float3 *extraction_corner_normals(const ExtractionHeader *header)
{
  return corner_normals_of().lookup_default(header, nullptr);
}
void blender::extraction_free(const ExtractionHeader &header) { corner_normals_of().remove(&header); }
/* How many headers have corner normals kept beside them, for checking that freeing a header frees them. */
EXPORT(extraction_corner_normals_count) int extraction_corner_normals_count() { return int(corner_normals_of().size()); }

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

/* What a modifier type a module leaves out reports (modifier-standins.hh): always disabled. */
bool modifier_left_out_is_disabled(const Scene * /*scene*/, ModifierData * /*md*/, bool /*use_render_params*/) { return true; }

/* port-override: no GPU in the module, so subdivision is evaluated on the CPU. */
GPUBackendType GPU_backend_get_type() { return GPU_BACKEND_NONE; }


/* A read ID of a type without its source keeps only its ID: the rest of it, the file's pointers among it, is cleared. */
static void read_without_data(BlendDataReader * /*reader*/, ID *id)
{
  memset(reinterpret_cast<char *>(id) + sizeof(ID), 0, BKE_idtype_get_info_from_id(id)->struct_size - sizeof(ID));
}

/* An ID type whose source the module does not build: the module makes none, and one a file has is read as its ID alone
 * (read_without_data), so it has what Blender's tables of ID types list and no other callbacks. modifiers-only.cc has
 * more. */
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
  info.blend_read_data = read_without_data;
  info.blend_read_after_liblink = nullptr;
  info.blend_read_undo_preserve = nullptr;
  info.lib_override_apply_post = nullptr;
  return info;
}

/* The module's one window manager is its context's, outside Main. */
IDTypeInfo IDType_ID_WM = id_type_without_data(ID_WM, FILTER_ID_WM, INDEX_ID_WM, sizeof(wmWindowManager), "WindowManager",
                                               "window_managers", BLT_I18NCONTEXT_ID_WINDOWMANAGER,
                                               IDTYPE_FLAGS_NO_COPY | IDTYPE_FLAGS_NO_LIBLINKING | IDTYPE_FLAGS_NO_ANIMDATA |
                                                   IDTYPE_FLAGS_NO_MEMFILE_UNDO | IDTYPE_FLAGS_NEVER_UNUSED);

}  // namespace blender
