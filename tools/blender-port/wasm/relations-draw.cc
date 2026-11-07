/* Relationship lines as Blender's overlay draws them: Blender's own overlay_relation.hh (draw/engines/overlay, the
 * Relations overlay: parents, hooks, rigid body constraints and constraint targets) compiled as it is, its sync filling
 * plain buffers where the draw manager's would be (port-override: the draw module is past the seam). Babylon draws the
 * lines with the overlay's extra_wire shader (src/draw/overlay-relations.js). Blender's overlay_base.hh is this file's
 * stand-ins: the build maps it to an empty header (blender_build.py OVERLAY_STAND_INS). */
#include "BKE_context.hh"
#include "BKE_layer.hh"
#include "BKE_object.hh"
#include "BKE_object_types.hh"
#include "BKE_scene.hh"
#include "BLI_listbase_wrapper.hh"
#include "BLI_math_matrix.hh"
#include "BLI_math_vector_types.hh"
#include "BLI_vector.hh"
#include "DEG_depsgraph.hh"
#include "DEG_depsgraph_query.hh"
#include "DNA_object_types.h"
#include "DNA_scene_types.h"
#include "DNA_space_types.h"
#include "DRW_render.hh"
#include "UI_resources.hh"
#include "draw_context_private.hh"
#include "draw_shader_shared.hh"
#include "draw_state.hh"
#include "engines/overlay/overlay_shader_shared.hh"

#define EXPORT(name) extern "C" __attribute__((export_name(#name)))

/* port-override: the overlay base, state and resources overlay_relation.hh syncs with, as plain buffers. An inline
 * namespace of its own keeps them apart from armature-draw.cc's. */
namespace blender::draw {
class View {};
class Manager {
 public:
  template<typename P> void submit(P & /*pass*/, View & /*view*/) {}
};
class Framebuffer {};
namespace overlay {
inline namespace relations_seam {

enum class SelectionType { DISABLED = 0, ENABLED = 1 };
namespace select {
struct ID {
  uint32_t value;
};
struct SelectMap {
  static ID select_invalid_id() { return {uint32_t(-1)}; }
};
}  // namespace select

class ObjectRef {
 public:
  Object *object;
};

struct PassSimple {
  struct Sub {
    template<typename T> void state_set(T /*state*/, int /*clipping_plane_count*/ = 0) {}
    void shader_set(void * /*shader*/) {}
  };
  Sub sub_;
  PassSimple(const char * /*name*/) {}
  void init() {}
  template<typename T> void bind_ubo(int /*slot*/, T * /*buffer*/) {}
  Sub &sub(const char * /*name*/) { return sub_; }
};

/* Line and point vertices with their colors, in the order the overlay appends them; end_sync hands each to `synced`,
 * as the overlay's passes would take them. */
struct VertexBuf;
static Vector<const VertexBuf *> synced;
struct VertexBuf {
  Vector<float4> data;
  VertexBuf(const SelectionType /*selection_type*/, const char * /*name*/ = nullptr) {}
  void clear() { data.clear(); }
  void end_sync(PassSimple::Sub & /*pass*/) { synced.append(this); }
};
struct LinePrimitiveBuf : VertexBuf {
  using VertexBuf::VertexBuf;
  void append(const float3 &start, const float3 &end, const float4 &color, select::ID = select::SelectMap::select_invalid_id())
  {
    data.extend({float4(start, 0.0f), color, float4(end, 0.0f), color});
  }
};
struct PointPrimitiveBuf : VertexBuf {
  using VertexBuf::VertexBuf;
  void append(const float3 &position, const float4 &color, select::ID = select::SelectMap::select_invalid_id())
  {
    data.extend({float4(position, 0.0f), color});
  }
};

struct Shader {
  void *get() { return nullptr; }
};
struct Resources {
  UniformData theme;
  int globals_buf = 0, clip_planes_buf = 0;
  struct {
    Shader extra_wire, extra_loose_points;
  } shaders_;
  decltype(shaders_) *shaders = &shaders_;
  bool is_selection() const { return false; }
  void select_bind(PassSimple & /*pass*/) {}
};

struct State {
  Depsgraph *depsgraph = nullptr;
  const Scene *scene = nullptr;
  int v3d_flag = 0;
  int clipping_plane_count = 0;
  bool is_space_v3d() const { return true; }
};

/* blender-port: overlay_base.hh Overlay, the methods Relations overrides. */
struct Overlay {
  bool enabled_ = false;
  virtual ~Overlay() = default;
  virtual void begin_sync(Resources &res, const State &state) = 0;
  virtual void object_sync(Manager & /*manager*/, const ObjectRef & /*ob_ref*/, Resources & /*res*/, const State & /*state*/) {}
  virtual void end_sync(Resources & /*res*/, const State & /*state*/) {}
  virtual void draw_line(Framebuffer & /*fb*/, Manager & /*manager*/, View & /*view*/) {}
};

/* blender-port: overlay_private.hh is_from_dupli_or_set. */
static inline bool is_from_dupli_or_set(const ObjectRef &ob_ref)
{
  return ob_ref.object->base_flag & (BASE_FROM_SET | BASE_FROM_DUPLI);
}
static inline void GPU_framebuffer_bind(Framebuffer & /*fb*/) {}

}  // namespace relations_seam
}  // namespace overlay
}  // namespace blender::draw

#include "engines/overlay/overlay_relation.hh"

namespace blender {
/* port-override: draw_context.cc is not in the module; the viewport's visibility, as it gives outside a render. */
int DRW_object_visibility_in_active_context(const Object *ob) { return BKE_object_visibility(ob, DAG_EVAL_VIEWPORT); }
}  // namespace blender

namespace blender {
using namespace draw::overlay;

/* The lines and points, each vertex its position and color (float4 pairs), counted in floats. */
struct RelationsDraw {
  const float *lines;
  int lines_len;
  const float *points;
  int points_len;
};

/* What the Relations overlay draws for the scene's evaluated objects, synced as Blender's overlay syncs them, valid
 * until the next call. */
EXPORT(relations_draw) const RelationsDraw *relations_draw(bContext *C)
{
  static RelationsDraw header;
  static Relations relations(SelectionType::DISABLED);
  static Resources resources;
  Depsgraph *depsgraph = CTX_data_depsgraph_pointer(C);
  BKE_scene_graph_update_tagged(depsgraph, CTX_data_main(C));
  DRWContext context(DRWContext::VIEWPORT, depsgraph, int2(1, 1));
  ui::theme::theme_set(SPACE_VIEW3D, RGN_TYPE_WINDOW);
  ui::theme::get_color_4fv(TH_WIRE, resources.theme.colors.wire);
  /* blender-port: overlay_instance.cc Resources::update_theme_settings, the colors the Relations overlay reads. */
  const int grid_axis_offset_i = int((ui::theme::theme_get()->space_view3d.grid_axis_brightness * 2.0f - 1.0f) * 255.0f);
  ui::theme::get_color_blend_shade_4fv(TH_GRID, TH_AXIS_Z, 0.85, grid_axis_offset_i, resources.theme.colors.grid_axis_z);
  State state;
  state.depsgraph = depsgraph;
  state.scene = CTX_data_scene(C);
  draw::Manager manager;
  relations.begin_sync(resources, state);
  DEGObjectIterSettings settings = {nullptr};
  settings.depsgraph = depsgraph;
  settings.flags = DEG_ITER_OBJECT_FLAG_LINKED_DIRECTLY | DEG_ITER_OBJECT_FLAG_VISIBLE;
  DEG_OBJECT_ITER_BEGIN (&settings, ob) {
    relations.object_sync(manager, ObjectRef{ob}, resources, state);
  }
  DEG_OBJECT_ITER_END;
  /* end_sync ends the lines' pass, then the points'. */
  synced.clear();
  relations.end_sync(resources, state);
  const auto floats = [](const VertexBuf *buf) { return buf ? reinterpret_cast<const float *>(buf->data.data()) : nullptr; };
  const auto count = [](const VertexBuf *buf) { return buf ? int(buf->data.size()) * 4 : 0; };
  const VertexBuf *lines = synced.size() > 0 ? synced[0] : nullptr, *points = synced.size() > 1 ? synced[1] : nullptr;
  header = {floats(lines), count(lines), floats(points), count(points)};
  return &header;
}

}  // namespace blender
