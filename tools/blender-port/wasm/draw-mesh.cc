/* A mesh's draw buffers as Blender's draw cache extracts them (draw_cache_extract_mesh.cc
 * mesh_buffer_cache_create_requested and its mesh_extractors, compiled as they are): one vertex per face corner with
 * its position, normal and UV, the triangles sorted by material, the face edges and the edges with their adjacent
 * corners. They fill the module's GPU backend (gpu-record.cc), whose buffers keep their data in module memory, where JS
 * uploads each from (src/draw/mesh-batch-cache.js) before freeing them. */
#include "BKE_attribute.hh"
#include "BKE_mesh_wrapper.hh"
#include "BKE_object.hh"
#include "BKE_subdiv_modifier.hh"
#include "BLI_task.h"
#include "DNA_object_types.h"
#include "DNA_scene_types.h"
#include "draw_attributes.hh"
#include "draw_cache_extract.hh"
#include "GPU_index_buffer.hh"
#include "gpu_capabilities_private.hh"
#include "extraction.hh"

namespace blender::gpu {

/* port-override: Blender's dummy backend makes no index buffers; this one keeps its indices where JS reads them. */
class ModuleIndexBuf : public IndexBuf {
 public:
  const void *indices() const { return data_; }
  uint32_t base() const { return index_base_; }
  void upload_data() override {}
  void bind_as_ssbo(uint /*binding*/) override {}
  void read(uint32_t * /*data*/) const override {}
  void update_sub(uint /*start*/, uint /*len*/, const void * /*data*/) override {}

 private:
  void strip_restart_indices() override {}
};

IndexBuf *module_index_buf_alloc() { return new ModuleIndexBuf; }

}  // namespace blender::gpu

namespace blender {

/* blender-port: draw_context.cc DRW_object_get_editmesh_cage_for_drawing (the draw manager is past the seam), which the
 * extraction reads of an object in Edit Mode. */
const Mesh *DRW_object_get_editmesh_cage_for_drawing(const Object &object)
{
  const Mesh *cage_mesh = BKE_object_get_editmesh_eval_cage(&object);
  if (cage_mesh == nullptr) {
    return nullptr;
  }
  if (BKE_subsurf_modifier_has_gpu_subdiv(cage_mesh)) {
    return cage_mesh;
  }
  return BKE_mesh_wrapper_ensure_subdivision(cage_mesh);
}

using draw::IBOType;
using draw::VBOType;

static draw::MeshBatchCache cache;
static DrawBuffers buffers;
static Vector<DrawBuffer> attribute_buffers;

/* Blender's axes as Babylon's, (x, y, z) as (x, z, y), in one pass over the positions and the normals; goes when
 * the swap becomes the object's transform (roadmap Optimizations: no CPU copy of vertex data). */
static void swap_yz(gpu::VertBuf &vbo)
{
  switch (vbo.format.attrs[0].type.format) {
    case gpu::VertAttrType::SFLOAT_32_32_32:
      for (float3 &position : vbo.data<float3>()) {
        std::swap(position.y, position.z);
      }
      break;
    case gpu::VertAttrType::SNORM_16_16_16_16:
      for (short4 &normal : vbo.data<short4>()) {
        std::swap(normal.y, normal.z);
      }
      break;
    default:
      BLI_assert_unreachable();
  }
}

static DrawBuffer vertex_buffer(VBOType type)
{
  const auto *found = cache.final.buff.vbos.lookup_ptr(type);
  if (!found) {
    return {};
  }
  gpu::VertBuf *vbo = found->get();
  const MutableSpan<uchar> data = vbo->data<uchar>();
  return {data.data(), int(data.size()), int(vbo->format.attrs[0].type.format), int(vbo->format.stride), int(vbo->vertex_len)};
}

/* A tangent or generic attribute's buffer, its type as DrawBuffers describes it. */
static DrawBuffer attribute_buffer(VBOType type)
{
  DrawBuffer buffer = vertex_buffer(type);
  if (buffer.data) {
    const GPUVertAttr::Type attr = cache.final.buff.vbos.lookup(type)->format.attrs[0].type;
    buffer.type = attr.comp_len() + (attr.comp_type() == GPU_COMP_U16 ? 16 : attr.comp_type() == GPU_COMP_I16 ? 32 : 0);
  }
  return buffer;
}

static DrawBuffer index_buffer(IBOType type)
{
  const auto *found = cache.final.buff.ibos.lookup_ptr(type);
  if (!found) {
    return {};
  }
  const auto *ibo = static_cast<const gpu::ModuleIndexBuf *>(found->get());
  BLI_assert(ibo->base() == 0);
  return {ibo->indices(), int(ibo->size_get()), ibo->is_32bit() ? 32 : 16, ibo->is_32bit() ? 4 : 2, int(ibo->index_len_get())};
}

void draw_buffers_free()
{
  cache.final.buff.vbos.clear();
  cache.final.buff.ibos.clear();
  cache.final.face_sorted = {};
  cache.final.loose_geom = {};
}

/* An attribute asked for by name, ":color" for the default color attribute (GPU_attribute_default_color). */
static StringRef attribute_name(const Mesh &mesh, const StringRef name)
{
  return name == ":color" ? StringRef(mesh.default_color_attribute ? mesh.default_color_attribute : "") : name;
}

const DrawBuffers *mesh_draw_buffers(const Scene &scene, Object &object, Mesh &mesh, const int what, const Span<std::string> attributes)
{
  draw_buffers_free();
  /* port-override: normals as 16-bit snorm, as Blender's HQ normals give them: Babylon has no 10_10_10_2 vertex type. */
  gpu::GCaps.use_hq_normals_workaround = true;
  cache.cd_used = {};
  if (const StringRef uv = shading_uv_map_name(mesh); !uv.is_empty()) {
    cache.cd_used.uv.add(uv);
  }
  Vector<VBOType> vbos = {VBOType::Position, VBOType::CornerNormal, VBOType::UVs};
  /* The attributes the mesh has of those asked for, as a material's GPU attributes request them (mesh_cd_calc_used_gpu_layers). */
  cache.attr_used.clear();
  const bke::AttributeAccessor accessor = mesh.attributes();
  for (const std::string &name : attributes) {
    if (accessor.contains(attribute_name(mesh, name))) {
      draw::drw_attributes_add_request(&cache.attr_used, attribute_name(mesh, name));
    }
  }
  for (const int i : cache.attr_used.index_range()) {
    vbos.append(VBOType(int8_t(VBOType::Attr0) + i));
  }
  if (what & DRAW_TANGENTS) {
    if (const StringRef uv = shading_uv_map_name(mesh); !uv.is_empty()) {
      cache.cd_used.tan.add(uv);
      vbos.append(VBOType::Tangents);
    }
  }
  Vector<IBOType> ibos = {IBOType::Tris};
  if (what & DRAW_LINES) {
    ibos.append(IBOType::Lines);
  }
  if (what & DRAW_LINES_ADJACENCY) {
    ibos.append(IBOType::LinesAdjacency);
  }
  TaskGraph *graph = BLI_task_graph_create();
  draw::mesh_buffer_cache_create_requested(*graph, scene, cache, cache.final, ibos, vbos, object, mesh, false, false, true, false, false);
  BLI_task_graph_free(graph);
  for (const VBOType type : {VBOType::Position, VBOType::CornerNormal}) {
    swap_yz(*cache.final.buff.vbos.lookup(type));
  }
  const draw::SortedFaceData &sorted = cache.final.face_sorted;
  buffers = {vertex_buffer(VBOType::Position), vertex_buffer(VBOType::CornerNormal),
             cache.cd_used.uv.is_empty() ? DrawBuffer{} : vertex_buffer(VBOType::UVs), index_buffer(IBOType::Tris),
             index_buffer(IBOType::Lines), index_buffer(IBOType::LinesAdjacency),
             cache.cd_used.tan.is_empty() ? DrawBuffer{} : attribute_buffer(VBOType::Tangents), int(sorted.tris_num_by_material.size()),
             sorted.tris_num_by_material.data()};
  attribute_buffers.clear();
  for (const std::string &name : attributes) {
    const int i = cache.attr_used.index_of_try(attribute_name(mesh, name));
    attribute_buffers.append(i == -1 ? DrawBuffer{} : attribute_buffer(VBOType(int8_t(VBOType::Attr0) + i)));
  }
  buffers.attributes_num = int(attribute_buffers.size());
  buffers.attributes = attribute_buffers.data();
  return &buffers;
}

}  // namespace blender
