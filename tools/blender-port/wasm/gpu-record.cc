/* The module's GPU backend (gpu_backend.hh): Blender's GPU module front end (gpu_shader.cc, gpu_texture.cc,
 * gpu_compute.cc, its create infos) runs on it as on any backend, and what it is asked to do is recorded, for Babylon
 * to replay on its own textures (src/compositor/compositor-replay.js): each texture's size and format, uploads,
 * clears, copies, and compute dispatches with their shader's create info, push constants and bound textures. Vertex
 * buffers are Blender's dummy backend's, which keep their data in module memory (draw-mesh.cc reads them). Nothing
 * runs here: a texture read gives zeros and is listed as unsupported, as are uniform and storage buffers. */
#include <cstring>
#include <string>

#include "BLI_map.hh"
#include "BLI_set.hh"
#include "BLI_vector.hh"
#include "GPU_capabilities.hh"
#include "GPU_context.hh"
#include "GPU_matrix.hh"
#include "GPU_state.hh"
#include "GPU_texture.hh"
#include "dummy/dummy_vertex_buffer.hh"
#include "gpu_backend.hh"
#include "gpu_capabilities_private.hh"
#include "gpu_context_private.hh"
#include "gpu_shader_create_info.hh"
#include "gpu_shader_create_info_private.hh"
#include "gpu_shader_dependency_private.hh"
#include "gpu_shader_interface.hh"
#include "gpu_shader_private.hh"
#include "gpu_state_private.hh"
#include "gpu_storage_buffer_private.hh"
#include "gpu_texture_pool_private.hh"
#include "gpu_texture_private.hh"
#include "gpu_uniform_buffer_private.hh"

#include "gpu-record.hh"

namespace blender::gpu {

IndexBuf *module_index_buf_alloc();

using shader::ShaderCreateInfo;

/* What is being recorded, between a Recording's start and end. */
static struct {
  Vector<std::string> textures, commands;
  Map<std::string, std::string> shaders;
  Vector<uint8_t> data;
  Set<std::string> unsupported;
  int textures_made = 0;
  Context *context = nullptr;
} record;

static std::string quoted(const StringRef text) { return "\"" + std::string(text) + "\""; }

template<typename T> static std::string json_list(const Span<T> values)
{
  std::string text = "[";
  for (const int64_t i : values.index_range()) {
    text += (i ? "," : "") + std::to_string(values[i]);
  }
  return text + "]";
}

static std::string json_object(const Map<std::string, std::string> &members)
{
  std::string text = "{";
  for (const auto item : members.items()) {
    text += (text.size() > 1 ? "," : "") + quoted(item.key) + ":" + item.value;
  }
  return text + "}";
}

static const char *data_format_name(const eGPUDataFormat format)
{
  switch (format) {
    case GPU_DATA_FLOAT:
      return "float";
    case GPU_DATA_HALF_FLOAT:
      return "half";
    case GPU_DATA_INT:
      return "int";
    case GPU_DATA_UINT:
      return "uint";
    case GPU_DATA_UBYTE:
      return "ubyte";
    default:
      return "packed";
  }
}

static const char *extend_name(const GPUSamplerExtendMode mode)
{
  switch (mode) {
    case GPU_SAMPLER_EXTEND_MODE_REPEAT:
      return "repeat";
    case GPU_SAMPLER_EXTEND_MODE_MIRRORED_REPEAT:
      return "mirrored_repeat";
    case GPU_SAMPLER_EXTEND_MODE_CLAMP_TO_BORDER:
      return "clamp_to_border";
    default:
      return "extend";
  }
}

/* port-override: a texture is its size, format and id; what is done to it is recorded. */
class RecordTexture : public Texture {
 public:
  const int id = record.textures_made++;

  RecordTexture(const char *name) : Texture(name) {}

  void generate_mipmap() override { record.commands.append("{\"op\":\"mipmap\",\"texture\":" + std::to_string(id) + "}"); }
  void copy_to(Texture *destination, IndexRange /*mip_levels*/) override
  {
    record.commands.append("{\"op\":\"copy\",\"from\":" + std::to_string(id) + ",\"to\":" +
                           std::to_string(static_cast<RecordTexture *>(destination)->id) + "}");
  }
  void clear(const double4 value) override
  {
    record.commands.append("{\"op\":\"clear\",\"texture\":" + std::to_string(id) + ",\"value\":" +
                           json_list(Span<double>(&value.x, 4)) + "}");
  }
  void swizzle_set(const char mask[4]) override
  {
    record.commands.append("{\"op\":\"swizzle\",\"texture\":" + std::to_string(id) + ",\"mask\":" +
                           quoted(StringRef(mask, 4)) + "}");
  }
  void mip_range_set(int /*min*/, int /*max*/) override {}
  void read(int /*mip*/, eGPUDataFormat format, void *destination) override
  {
    record.unsupported.add("texture read");
    memset(destination, 0, this->read_size_get(0, format));
  }
  void update_sub(int mip, int offset[3], int extent[3], eGPUDataFormat format, const void *data, uint row_length) override
  {
    const size_t bytes = to_bytesize(format_, format) * size_t(extent[0]) * std::max(extent[1], 1) * std::max(extent[2], 1);
    if (row_length && row_length != uint(extent[0])) {
      record.unsupported.add("texture update with a row length");
    }
    record.commands.append("{\"op\":\"update\",\"texture\":" + std::to_string(id) + ",\"mip\":" + std::to_string(mip) +
                           ",\"offset\":" + json_list(Span<int>(offset, 3)) + ",\"extent\":" + json_list(Span<int>(extent, 3)) +
                           ",\"format\":" + quoted(data_format_name(format)) + ",\"data\":" + std::to_string(record.data.size()) +
                           ",\"bytes\":" + std::to_string(bytes) + "}");
    record.data.extend(Span<uint8_t>(static_cast<const uint8_t *>(data), bytes));
  }
  void update_sub(int /*offset*/[3], int /*extent*/[3], eGPUDataFormat /*format*/, GPUPixelBuffer * /*pixbuf*/) override
  {
    record.unsupported.add("pixel buffer upload");
  }

 protected:
  bool init_internal() override
  {
    record.textures.append("{\"id\":" + std::to_string(id) + ",\"size\":" + json_list(Span<int>({w_, h_, d_})) +
                           ",\"type\":" + std::to_string(int(type_)) + ",\"format\":" + quoted(GPU_texture_format_name(format_)) + "}");
    return true;
  }
  bool init_internal(VertBuf * /*vbo*/) override
  {
    record.unsupported.add("buffer texture");
    return init_internal();
  }
  bool init_internal(Texture * /*src*/, int /*mip_offset*/, int /*layer_offset*/, bool /*use_stencil*/) override
  {
    record.unsupported.add("texture view");
    return init_internal();
  }
};

/* blender-port: vulkan/vk_shader_interface.cc VKShaderInterface::populate_shader_inputs, for push constants, samplers
 * and images: each push constant's location is its index, each texture's binding its slot. */
class RecordInterface : public ShaderInterface {
 public:
  RecordInterface(const ShaderCreateInfo &info)
  {
    const Vector<ShaderCreateInfo::Resource> resources = info.resources_get_all_();
    uniform_len_ = info.push_constants_.size();
    for (const ShaderCreateInfo::Resource &resource : resources) {
      uniform_len_ += ELEM(resource.bind_type, ShaderCreateInfo::Resource::SAMPLER, ShaderCreateInfo::Resource::IMAGE);
    }
    inputs_ = MEM_new_array_zeroed<ShaderInput>(uniform_len_, __func__);
    name_buffer_ = MEM_new_array_uninitialized<char>(info.interface_names_size_ + 1, "name_buffer");
    ShaderInput *input = inputs_;
    uint32_t offset = 0;
    for (const ShaderCreateInfo::Resource &resource : resources) {
      if (resource.bind_type == ShaderCreateInfo::Resource::SAMPLER) {
        copy_input_name(input, resource.sampler.name, name_buffer_, offset);
        enabled_tex_mask_ |= uint64_t(1) << resource.slot;
      }
      else if (resource.bind_type == ShaderCreateInfo::Resource::IMAGE) {
        copy_input_name(input, resource.image.name, name_buffer_, offset);
        enabled_ima_mask_ |= uint8_t(1 << resource.slot);
      }
      else {
        continue;
      }
      input->location = input->binding = resource.slot;
      input++;
    }
    for (const int i : info.push_constants_.index_range()) {
      copy_input_name(input, info.push_constants_[i].name, name_buffer_, offset);
      input->location = i;
      input->binding = -1;
      input++;
    }
    set_image_formats_from_info(info);
    sort_inputs();
    for (int i = 0; i < GPU_NUM_UNIFORMS; i++) {
      builtins_[i] = -1;
    }
    for (int i = 0; i < GPU_NUM_UNIFORM_BLOCKS; i++) {
      builtin_blocks_[i] = -1;
    }
  }
};

/* Blender's GLSL names of its shader types (gpu_shader_compat_glsl.glsl). */
static const char *type_name(const shader::Type type)
{
  using shader::Type;
  switch (type) {
    case Type::float_t:
      return "float";
    case Type::float2_t:
      return "float2";
    case Type::float3_t:
      return "float3";
    case Type::float4_t:
      return "float4";
    case Type::float3x3_t:
      return "float3x3";
    case Type::float4x4_t:
      return "float4x4";
    case Type::uint_t:
      return "uint";
    case Type::uint2_t:
      return "uint2";
    case Type::uint3_t:
      return "uint3";
    case Type::uint4_t:
      return "uint4";
    case Type::int_t:
      return "int";
    case Type::int2_t:
      return "int2";
    case Type::int3_t:
      return "int3";
    case Type::int4_t:
      return "int4";
    case Type::bool_t:
      return "bool";
    default:
      return "unsupported";
  }
}

/* blender-port: opengl/gl_shader.cc print_image_type, the GLSL type of a sampler or image. */
static std::string image_type_name(const shader::ImageType type, const bool image)
{
  using shader::ImageType;
  std::string name;
  switch (type) {
    case ImageType::Int1D:
    case ImageType::Int1DArray:
    case ImageType::Int2D:
    case ImageType::Int2DArray:
    case ImageType::Int3D:
      name = "i";
      break;
    case ImageType::Uint1D:
    case ImageType::Uint1DArray:
    case ImageType::Uint2D:
    case ImageType::Uint2DArray:
    case ImageType::Uint3D:
      name = "u";
      break;
    default:
      break;
  }
  name += image ? "image" : "sampler";
  switch (type) {
    case ImageType::Float1D:
    case ImageType::Int1D:
    case ImageType::Uint1D:
      return name + "1D";
    case ImageType::Float1DArray:
    case ImageType::Int1DArray:
    case ImageType::Uint1DArray:
      return name + "1DArray";
    case ImageType::Float2D:
    case ImageType::Int2D:
    case ImageType::Uint2D:
      return name + "2D";
    case ImageType::Float2DArray:
    case ImageType::Int2DArray:
    case ImageType::Uint2DArray:
      return name + "2DArray";
    case ImageType::Float3D:
    case ImageType::Int3D:
    case ImageType::Uint3D:
      return name + "3D";
    default:
      return "unsupported";
  }
}

static std::string qualifiers_name(const shader::Qualifier qualifiers)
{
  using shader::Qualifier;
  const bool read = bool(qualifiers & Qualifier::read), write = bool(qualifiers & Qualifier::write);
  return read && write ? "read_write" : read ? "read" : "write";
}

/* A create info as JSON: what the replay declares (defines, push constants, samplers, images) around its compute
 * source, and its work group size. */
static std::string info_json(const ShaderCreateInfo &info)
{
  std::string defines = "[", push_constants = "[", samplers = "[", images = "[";
  for (const auto &define : info.defines_) {
    defines += std::string(defines.size() > 1 ? "," : "") + "[" + quoted(define[0]) + "," + quoted(define[1]) + "]";
  }
  for (const ShaderCreateInfo::PushConst &constant : info.push_constants_) {
    push_constants += std::string(push_constants.size() > 1 ? "," : "") + "{\"name\":" + quoted(constant.name.str_no_array()) +
                      ",\"type\":" + quoted(type_name(constant.type)) + ",\"array\":" + std::to_string(constant.array_size) + "}";
  }
  for (const ShaderCreateInfo::Resource &resource : info.resources_get_all_()) {
    if (resource.bind_type == ShaderCreateInfo::Resource::SAMPLER) {
      samplers += std::string(samplers.size() > 1 ? "," : "") + "{\"slot\":" + std::to_string(resource.slot) + ",\"name\":" +
                  quoted(resource.sampler.name) + ",\"type\":" + quoted(image_type_name(resource.sampler.type, false)) + "}";
    }
    else if (resource.bind_type == ShaderCreateInfo::Resource::IMAGE) {
      images += std::string(images.size() > 1 ? "," : "") + "{\"slot\":" + std::to_string(resource.slot) + ",\"name\":" +
                quoted(resource.image.name) + ",\"type\":" + quoted(image_type_name(resource.image.type, true)) + ",\"format\":" +
                quoted(GPU_texture_format_name(TextureFormat(resource.image.format))) + ",\"access\":" +
                quoted(qualifiers_name(resource.image.qualifiers)) + "}";
    }
    else {
      record.unsupported.add(info.name_ + " buffers");
    }
  }
  std::string typedefs = "[";
  for (const StringRefNull source : info.typedef_sources_) {
    typedefs += (typedefs.size() > 1 ? "," : "") + quoted(source);
  }
  /* Compilation constants, as opengl/gl_shader.cc resources_declare declares them. */
  std::string constants = "[";
  for (const shader::CompilationConstant &constant : info.compilation_constants_) {
    const std::string value = constant.type == shader::Type::uint_t ? std::to_string(constant.value.u) + "u" :
                              constant.type == shader::Type::bool_t ? (constant.value.u ? "true" : "false") :
                                                                      std::to_string(constant.value.i);
    constants += std::string(constants.size() > 1 ? "," : "") + "{\"name\":" + quoted(constant.name) + ",\"type\":" +
                 quoted(type_name(constant.type)) + ",\"value\":" + quoted(value) + "}";
  }
  const ShaderCreateInfo::ComputeStageLayout &layout = info.compute_layout_;
  return "{\"source\":" + quoted(info.compute_source_) + ",\"group\":" +
         json_list(Span<int>({layout.local_size_x, std::max(layout.local_size_y, 1), std::max(layout.local_size_z, 1)})) +
         ",\"typedefs\":" + typedefs + "],\"defines\":" + defines + "],\"constants\":" + constants + "],\"push_constants\":" +
         push_constants + "],\"samplers\":" + samplers + "],\"images\":" + images + "]}";
}

/* port-override: a shader is its create info, recorded once, and the push constants last set, which each dispatch
 * records. */
class RecordShader : public Shader {
  std::string info_name_;
  Vector<std::string> push_constant_names_;
  Map<int, std::string> push_constants_;

 public:
  RecordShader(const char *name) : Shader(name) {}

  void init(const ShaderCreateInfo &info, bool /*is_codegen_only*/) override
  {
    info_name_ = info.name_;
    for (const ShaderCreateInfo::PushConst &constant : info.push_constants_) {
      push_constant_names_.append(constant.name.str_no_array());
    }
    interface = new RecordInterface(info);
    record.shaders.lookup_or_add_cb(info_name_, [&]() { return info_json(info); });
  }
  const ShaderCreateInfo &patch_create_info(const ShaderCreateInfo &info) override { return info; }
  void vertex_shader_from_glsl(const ShaderCreateInfo & /*info*/, MutableSpan<StringRefNull> /*sources*/) override {}
  void geometry_shader_from_glsl(const ShaderCreateInfo & /*info*/, MutableSpan<StringRefNull> /*sources*/) override {}
  void fragment_shader_from_glsl(const ShaderCreateInfo & /*info*/, MutableSpan<StringRefNull> /*sources*/) override {}
  void compute_shader_from_glsl(const ShaderCreateInfo & /*info*/, MutableSpan<StringRefNull> /*sources*/) override {}
  bool finalize(const ShaderCreateInfo * /*info*/) override { return true; }
  void warm_cache(int /*limit*/) override {}
  void bind(const shader::SpecializationConstants * /*constants_state*/) override {}
  void unbind() override {}
  void uniform_float(int location, int comp_len, int array_size, const float *data) override
  {
    push_constants_.add_overwrite(location, json_list(Span<float>(data, comp_len * array_size)));
  }
  void uniform_int(int location, int comp_len, int array_size, const int *data) override
  {
    push_constants_.add_overwrite(location, json_list(Span<int>(data, comp_len * array_size)));
  }
  std::string resources_declare(const ShaderCreateInfo & /*info*/) const override { return {}; }
  std::string vertex_interface_declare(const ShaderCreateInfo & /*info*/) const override { return {}; }
  std::string fragment_interface_declare(const ShaderCreateInfo & /*info*/) const override { return {}; }
  std::string geometry_interface_declare(const ShaderCreateInfo & /*info*/) const override { return {}; }
  std::string geometry_layout_declare(const ShaderCreateInfo & /*info*/) const override { return {}; }
  std::string compute_layout_declare(const ShaderCreateInfo & /*info*/) const override { return {}; }

  const std::string &info_name() const { return info_name_; }
  std::string push_constants_json() const
  {
    Map<std::string, std::string> named;
    for (const auto item : push_constants_.items()) {
      named.add(push_constant_names_[item.key], item.value);
    }
    return json_object(named);
  }
};

/* port-override: the textures bound to each sampler and image unit, which each dispatch records. */
class RecordStateManager : public StateManager {
 public:
  Map<int, std::string> samplers, images;

  void apply_state() override {}
  void force_state() override {}
  void issue_barrier(GPUBarrier /*barrier_bits*/) override {}
  void texture_bind(Texture *texture, GPUSamplerState sampler, int unit) override
  {
    samplers.add_overwrite(unit, "{\"texture\":" + std::to_string(static_cast<RecordTexture *>(texture)->id) +
                                     ",\"linear\":" + (sampler.filtering & GPU_SAMPLER_FILTERING_LINEAR ? "true" : "false") +
                                     ",\"extend\":[" + quoted(extend_name(sampler.extend_x)) + "," +
                                     quoted(extend_name(sampler.extend_yz)) + "]}");
  }
  void texture_unbind(Texture *texture) override
  {
    samplers.remove_if([&](auto item) { return item.value.find("\"texture\":" + std::to_string(static_cast<RecordTexture *>(texture)->id) + ",") != std::string::npos; });
  }
  void texture_unbind_all() override { samplers.clear(); }
  void image_bind(Texture *texture, int unit) override
  {
    images.add_overwrite(unit, std::to_string(static_cast<RecordTexture *>(texture)->id));
  }
  void image_unbind(Texture *texture) override
  {
    images.remove_if([&](auto item) { return item.value == std::to_string(static_cast<RecordTexture *>(texture)->id); });
  }
  void image_unbind_all() override { images.clear(); }
};

static std::string slots_json(const Map<int, std::string> &slots)
{
  Map<std::string, std::string> named;
  for (const auto item : slots.items()) {
    named.add(std::to_string(item.key), item.value);
  }
  return json_object(named);
}

/* port-override: the context the recording runs in (gpu/dummy/dummy_context.hh, with a recording state manager and no
 * frame buffers: compute shaders draw into none, and the region's drawing is region-draw.cc's). */
class RecordContext : public Context {
 public:
  RecordContext()
  {
    state_manager = new RecordStateManager;
  }
  ~RecordContext() override { free_resources(); }
  void activate() override {}
  void deactivate() override {}
  void begin_frame() override {}
  void end_frame() override {}
  void flush() override {}
  void finish() override {}
  void memory_statistics_get(int * /*r_total_mem*/, int * /*r_free_mem*/) override {}
  void debug_group_begin(const char * /*name*/, int /*index*/) override {}
  void debug_group_end() override {}
  bool debug_capture_begin(const char * /*title*/) override { return false; }
  void debug_capture_end() override {}
  void *debug_capture_scope_create(const char * /*name*/) override { return nullptr; }
  bool debug_capture_scope_begin(void * /*scope*/) override { return false; }
  void debug_capture_scope_end(void * /*scope*/) override {}
  void debug_unbind_all_ubo() override {}
  void debug_unbind_all_ssbo() override {}
};

/* port-override: uniform and storage buffers are not replayed; a shader that uses one is listed as unsupported. */
class RecordUniformBuf : public UniformBuf {
 public:
  RecordUniformBuf(size_t size, const char *name) : UniformBuf(size, name) {}
  void update(const void * /*data*/) override {}
  void clear_to_zero() override {}
  void bind(int /*slot*/) override { record.unsupported.add("uniform buffer"); }
  void bind_as_ssbo(int /*slot*/) override { record.unsupported.add("uniform buffer"); }
  void unbind() override {}
};

class RecordStorageBuf : public StorageBuf {
 public:
  RecordStorageBuf(size_t size, const char *name) : StorageBuf(size, name) {}
  void update(const void * /*data*/) override {}
  void bind(int /*slot*/) override { record.unsupported.add("storage buffer"); }
  void unbind() override {}
  void clear(uint32_t /*clear_value*/) override {}
  void copy_sub(VertBuf * /*src*/, uint /*dst_offset*/, uint /*src_offset*/, uint /*copy_size*/) override {}
  void read(void *data) override
  {
    record.unsupported.add("storage buffer read");
    memset(data, 0, size_in_bytes_);
  }
  void async_flush_to_host() override {}
  void sync_as_indirect_buffer() override {}
};

/* port-override: the module's GPU backend (GPU_BACKEND_NONE, as in background mode): vertex buffers are Blender's dummy
 * backend's, index buffers draw-mesh.cc's, everything else recorded. Shaders compile on the calling thread. */
class ModuleBackend : public GPUBackend {
 public:
  ModuleBackend()
  {
    GCaps.use_main_context_workaround = true;
    compiler_ = new ShaderCompiler();
  }
  VertBuf *vertbuf_alloc() override { return new DummyVertexBuffer; }
  IndexBuf *indexbuf_alloc() override { return module_index_buf_alloc(); }
  void init_resources() override {}
  void delete_resources() override {}
  void compute_dispatch(int x, int y, int z) override
  {
    Context &context = *Context::get();
    const RecordShader &shader = *static_cast<RecordShader *>(context.shader);
    const RecordStateManager &state = *static_cast<RecordStateManager *>(context.state_manager);
    record.commands.append("{\"op\":\"dispatch\",\"shader\":" + quoted(shader.info_name()) + ",\"groups\":" +
                           json_list(Span<int>({x, y, z})) + ",\"push_constants\":" + shader.push_constants_json() +
                           ",\"samplers\":" + slots_json(state.samplers) + ",\"images\":" + slots_json(state.images) + "}");
  }
  void compute_dispatch_indirect(StorageBuf * /*indirect_buf*/) override { record.unsupported.add("indirect dispatch"); }
  Context *context_alloc(GHOST_IWindow * /*window*/, GHOST_IContext * /*context*/) override { return new RecordContext; }
  Batch *batch_alloc() override { return nullptr; }
  Fence *fence_alloc() override { return nullptr; }
  FrameBuffer *framebuffer_alloc(const char * /*name*/) override { return nullptr; }
  PixelBuffer *pixelbuf_alloc(size_t /*size*/) override { return nullptr; }
  QueryPool *querypool_alloc() override { return nullptr; }
  Shader *shader_alloc(const char *name) override { return new RecordShader(name); }
  Texture *texture_alloc(const char *name) override { return new RecordTexture(name); }
  TexturePool *texturepool_alloc() override { return new TexturePoolImpl; }
  UniformBuf *uniformbuf_alloc(size_t size, const char *name) override { return new RecordUniformBuf(size, name); }
  StorageBuf *storagebuf_alloc(size_t size, GPUUsageType /*usage*/, const char *name) override
  {
    return new RecordStorageBuf(size, name);
  }
  void shader_cache_dir_clear_old() override {}
  void render_begin() override {}
  void render_end() override {}
  void render_step(bool /*force_resource_release*/) override {}
};

GPUBackend *GPUBackend::get()
{
  static ModuleBackend backend;
  return &backend;
}

/* blender-port: gpu_context.cc Context methods, without the matrix state, frame buffers (the region's drawing is
 * region-draw.cc's) or procedural batches; the one context is the recording's. */
Context::Context()
{
  thread_ = pthread_self();
  is_active_ = false;
  texture_pool = GPUBackend::get()->texturepool_alloc();
  context_id = Context::context_counter++;
}

Context::~Context()
{
  delete state_manager;
  delete imm;
}

void Context::free_resources()
{
  delete texture_pool;
  texture_pool = nullptr;
}

bool Context::is_active_on_thread() { return this == record.context; }

Context *Context::get() { return record.context; }

/* blender-port: gpu_state.cc StateManager::StateManager, whose state nothing here applies. */
StateManager::StateManager() { image_formats.fill(TextureWriteFormat::Invalid); }

Recording::Recording()
{
  /* blender-port: gpu_init_exit.cc GPU_init, the part shaders are created from. */
  static const bool infos = (gpu_shader_create_info_init(), true);
  UNUSED_VARS(infos);
  record.textures.clear();
  record.commands.clear();
  record.shaders.clear();
  record.data.clear();
  record.unsupported.clear();
  record.textures_made = 0;
  record.context = GPUBackend::get()->context_alloc(nullptr, nullptr);
}

Recording::~Recording()
{
  record.context->texture_pool->reset(true);
  delete record.context;
  record.context = nullptr;
}

int Recording::id(const Texture *texture) { return static_cast<const RecordTexture *>(texture)->id; }

std::string Recording::json()
{
  auto list = [](const Span<std::string> items) {
    std::string text = "[";
    for (const int64_t i : items.index_range()) {
      text += (i ? "," : "") + items[i];
    }
    return text + "]";
  };
  Vector<std::string> unsupported;
  for (const std::string &what : record.unsupported) {
    unsupported.append(quoted(what));
  }
  return "{\"textures\":" + list(record.textures) + ",\"shaders\":" + json_object(record.shaders) + ",\"commands\":" +
         list(record.commands) + ",\"unsupported\":" + list(unsupported) + "}";
}

Span<uint8_t> Recording::data() { return record.data; }

}  // namespace blender::gpu

namespace blender {

using namespace gpu;

/* port-override: the active context is the recording's (gpu_context.cc keeps one per thread). */
void GPU_context_active_set(GPUContext * /*ctx*/) {}
GPUContext *GPU_context_active_get() { return wrap(Context::get()); }
void GPU_context_main_lock() {}
void GPU_context_main_unlock() {}
void GPU_render_begin() {}
void GPU_render_end() {}
void GPU_render_step(bool /*force_resource_release*/) {}

/* port-override: dispatches are recorded in order, which the replay keeps; there is nothing to wait for. */
void GPU_memory_barrier(GPUBarrier /*barrier*/) {}

/* port-override: compute shaders bind no matrices (gpu_matrix.cc's state is the region's, region-draw.cc). */
void GPU_matrix_bind(gpu::Shader * /*shader*/) {}
bool GPU_matrix_dirty_get() { return false; }

}  // namespace blender

namespace blender::gpu::shader {

/* port-override: the module ships no GLSL (gpu_shader_dependency.cc reads Blender's, built in); the replay resolves a
 * compute source's includes from the GLSL Bylonder ships (src/nodes/blender/gpu-library.js). */
BuiltinBits gpu_shader_dependency_get_builtins(const StringRefNull /*source_name*/) { return BuiltinBits::NONE; }

Span<ShaderCreateInfo::SharedVariable> gpu_shader_dependency_get_shared_variables(const StringRefNull /*source_name*/)
{
  return {};
}

Vector<StringRefNull> gpu_shader_dependency_get_resolved_source(const StringRefNull /*source_name*/,
                                                                const GeneratedSourceList & /*generated_sources*/,
                                                                const StringRefNull /*shader_name*/)
{
  return {};
}

bool gpu_shader_dependency_force_gpu_print_injection() { return false; }

}  // namespace blender::gpu::shader
