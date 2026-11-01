/* Armatures as Blender's overlay draws them: Blender's own overlay_armature.cc (draw/engines/overlay) compiled as it is,
 * its sync filling plain buffers where the draw manager's would be (port-override: the draw module is past the seam).
 * Each buffer holds what one of the overlay's shaders reads per instance (bone matrices with their packed colors,
 * envelope spheres, stick ends, wire and relationship line vertices, axes); Babylon draws them with those shaders
 * (src/draw/overlay-armature.js). Synced for selection, each instance carries its select id (the bone's index << 16 |
 * BONESEL_*), which Bylonder's picking reads in place of the GPU's selection buffer. Blender's overlay_armature.hh is
 * this file's stand-ins: the build maps it to an empty header (blender_build.py OVERLAY_STAND_INS). */
#include "BKE_context.hh"
#include "BKE_global.hh"
#include "BKE_layer.hh"
#include "BKE_mesh.hh"
#include "BKE_object.hh"
#include "BKE_object_types.hh"
#include "BLI_array.hh"
#include "BLI_map.hh"
#include "BLI_math_color.h"
#include "BLI_math_matrix.hh"
#include "BLI_math_vector.h"
#include "BLI_ordered_edge.hh"
#include "BLI_rect.h"
#include "DEG_depsgraph_query.hh"
#include "DNA_curve_types.h"
#include "DNA_screen_types.h"
#include "DNA_space_types.h"
#include "DNA_userdef_types.h"
#include "DRW_render.hh"
#include "UI_resources.hh"
#include "draw_cache.hh"
#include "draw_cache_impl.hh"
#include "draw_context_private.hh"
#include "draw_manager_text.hh"
#include "engines/overlay/overlay_shader_shared.hh"

#include <string>

void view3d_matrices_set(blender::RegionView3D &rv3d, const float *viewmat, const float *winmat, int winx, int winy,
                         bool is_persp);

#define EXPORT(name) extern "C" __attribute__((export_name(#name)))

/* port-override: the draw manager's types overlay_armature.cc syncs into, as plain buffers. */
namespace blender::draw {

class ObjectRef {
 public:
  Object *object;
};

namespace select {
enum class SelectionType { DISABLED = 0, ENABLED = 1 };
class ID {
 public:
  uint32_t value;
};
struct SelectMap {
  static ID select_invalid_id() { return {uint32_t(-1)}; }
};
}  // namespace select

namespace overlay {
using select::SelectionType;

/* blender-port: overlay_private.hh BoneInstanceData. */
struct BoneInstanceData {
  union {
    float4x4 mat44;
    float mat[4][4];
    struct {
      float _pad0[3], color_hint_a;
      float _pad1[3], color_hint_b;
      float _pad2[3], color_a;
      float _pad3[3], color_b;
    };
  };

  BoneInstanceData() = default;
  BoneInstanceData(const float4x4 &bone_mat, const float4 &bone_color, const float4 &hint_color) : mat44(bone_mat)
  {
    set_color(bone_color);
    set_hint_color(hint_color);
  };
  BoneInstanceData(const float4x4 &bone_mat, const float4 &bone_color) : mat44(bone_mat) { set_color(bone_color); };

  void set_color(const float4 &bone_color)
  {
    color_a = encode_2f_to_float(bone_color[0], bone_color[1]);
    color_b = encode_2f_to_float(bone_color[2], bone_color[3]);
  }
  void set_hint_color(const float4 &hint_color)
  {
    color_hint_a = encode_2f_to_float(hint_color[0], hint_color[1]);
    color_hint_b = encode_2f_to_float(hint_color[2], hint_color[3]);
  }

 private:
  float encode_2f_to_float(float a, float b) const
  {
    return float(int(clamp_f(a, 0.0f, 1.0f) * 255) | (int(clamp_f(b, 0.0f, 2.0f) * 255) << 8));
  }
};

/* The instances of one shape, with their select ids. */
template<typename InstanceDataT> struct ShapeInstanceBuf {
  Vector<InstanceDataT> data;
  Vector<uint32_t> ids;

  ShapeInstanceBuf(const SelectionType /*selection_type*/, const char * /*name*/ = nullptr) {}
  void append(const InstanceDataT &instance, select::ID select_id)
  {
    data.append(instance);
    ids.append(select_id.value);
  }
};

/* Lines as VertexData pairs, a select id each. */
struct LinePrimitiveBuf {
  Vector<VertexData> data;
  Vector<uint32_t> ids;

  LinePrimitiveBuf(const SelectionType /*selection_type*/, const char * /*name*/ = nullptr) {}
  void append(const float3 &start, const float3 &end, const float4 &color, select::ID select_id = select::SelectMap::select_invalid_id())
  {
    data.append({float4(start, 0.0f), color});
    data.append({float4(end, 0.0f), color});
    ids.append(select_id.value);
  }
};

/* What a custom shape draws: an object's evaluated mesh as one of the draw cache's batches, or an empty's shape. The
 * overlay keys its instance buffers by the batch, as here by this. */
enum class ShapeGeometry { Surface, EdgeDetection, LooseEdges, AllEdges, PlainAxes, SingleArrow, Cube, Circle, Sphere, Cone, Arrows };
struct ShapeBatch {
  const Mesh *mesh;
  ShapeGeometry geometry;
};
static Map<std::pair<const Mesh *, ShapeGeometry>, std::unique_ptr<ShapeBatch>> shape_batches;
static gpu::Batch *shape_batch(const Mesh *mesh, ShapeGeometry geometry)
{
  ShapeBatch &batch = *shape_batches.lookup_or_add_cb({mesh, geometry}, [&]() { return std::make_unique<ShapeBatch>(ShapeBatch{mesh, geometry}); });
  return reinterpret_cast<gpu::Batch *>(&batch);
}
static const ShapeBatch &batch_shape(gpu::Batch *batch) { return *reinterpret_cast<ShapeBatch *>(batch); }

struct EmptyShape {
  ShapeGeometry geometry;
  gpu::Batch *get() const { return shape_batch(nullptr, geometry); }
};

struct Resources {
  UniformData theme;
  bool selecting = false;
  struct {
    EmptyShape plain_axes{ShapeGeometry::PlainAxes}, single_arrow{ShapeGeometry::SingleArrow}, cube{ShapeGeometry::Cube},
        circle{ShapeGeometry::Circle}, empty_sphere{ShapeGeometry::Sphere}, empty_cone{ShapeGeometry::Cone}, arrows{ShapeGeometry::Arrows};
  } shapes;

  bool is_selection() const { return selecting; }
  select::ID select_id(const ObjectRef & /*ob_ref*/, uint sub_object_id = 0) const { return {selecting ? sub_object_id : uint32_t(-1)}; }
};

/* blender-port: overlay_private.hh is_from_dupli_or_set. */
static inline bool is_from_dupli_or_set(const Object *ob) { return ob->base_flag & (BASE_FROM_SET | BASE_FROM_DUPLI); }

enum eArmatureDrawMode {
  ARM_DRAW_MODE_OBJECT,
  ARM_DRAW_MODE_POSE,
  ARM_DRAW_MODE_EDIT,
};

/* blender-port: overlay_armature.hh Armatures, its buffers and draw context, without the passes they end in. */
class Armatures {
 public:
  using EmptyInstanceBuf = ShapeInstanceBuf<ExtraInstanceData>;
  using BoneInstanceBuf = ShapeInstanceBuf<BoneInstanceData>;
  using BoneEnvelopeBuf = ShapeInstanceBuf<BoneEnvelopeData>;
  using BoneStickBuf = ShapeInstanceBuf<BoneStickData>;
  using DegreesOfFreedomBuf = ShapeInstanceBuf<ExtraInstanceData>;

  struct BoneBuffers {
    const SelectionType selection_type_;

    BoneInstanceBuf bbones_fill_buf = {selection_type_, "bbones_fill_buf"};
    BoneInstanceBuf bbones_outline_buf = {selection_type_, "bbones_outline_buf"};
    BoneInstanceBuf octahedral_fill_buf = {selection_type_, "octahedral_fill_buf"};
    BoneInstanceBuf octahedral_outline_buf = {selection_type_, "octahedral_outline_buf"};
    BoneInstanceBuf sphere_fill_buf = {selection_type_, "sphere_fill_buf"};
    BoneInstanceBuf sphere_outline_buf = {selection_type_, "sphere_outline_buf"};
    BoneEnvelopeBuf envelope_fill_buf = {selection_type_, "envelope_fill_buf"};
    BoneEnvelopeBuf envelope_outline_buf = {selection_type_, "envelope_outline_buf"};
    BoneEnvelopeBuf envelope_distance_buf = {selection_type_, "envelope_distance_buf"};
    BoneStickBuf stick_buf = {selection_type_, "stick_buf"};
    LinePrimitiveBuf wire_buf = {selection_type_, "wire_buf"};
    EmptyInstanceBuf arrows_buf = {selection_type_, "arrows_buf"};
    DegreesOfFreedomBuf degrees_of_freedom_fill_buf = {SelectionType::DISABLED, "degrees_of_freedom_buf"};
    DegreesOfFreedomBuf degrees_of_freedom_wire_buf = {SelectionType::DISABLED, "degrees_of_freedom_buf"};
    LinePrimitiveBuf relations_buf = {SelectionType::DISABLED, "relations_buf"};

    Map<gpu::Batch *, std::unique_ptr<BoneInstanceBuf>> custom_shape_fill;
    Map<gpu::Batch *, std::unique_ptr<BoneInstanceBuf>> custom_shape_outline;
    Map<gpu::Batch *, std::unique_ptr<BoneInstanceBuf>> custom_shape_wire;

    static BoneInstanceBuf &custom_buffer(Map<gpu::Batch *, std::unique_ptr<BoneInstanceBuf>> &map, gpu::Batch *geom)
    {
      return *map.lookup_or_add_cb(geom, []() { return std::make_unique<BoneInstanceBuf>(SelectionType::ENABLED); });
    }
    BoneInstanceBuf &custom_shape_fill_get_buffer(gpu::Batch *geom) { return custom_buffer(custom_shape_fill, geom); }
    BoneInstanceBuf &custom_shape_outline_get_buffer(gpu::Batch *geom) { return custom_buffer(custom_shape_outline, geom); }
    BoneInstanceBuf &custom_shape_wire_get_buffer(gpu::Batch *geom) { return custom_buffer(custom_shape_wire, geom); }

    BoneBuffers(const SelectionType selection_type) : selection_type_(selection_type) {};
  };

  struct DrawContext {
    Object *ob = nullptr;
    const ObjectRef *ob_ref = nullptr;
    bArmature *armature = nullptr;
    eArmatureDrawMode draw_mode = ARM_DRAW_MODE_OBJECT;
    eArmature_Drawtype drawtype = ARM_DRAW_TYPE_OCTA;
    Armatures::BoneBuffers *bone_buf = nullptr;
    Resources *res = nullptr;
    DRWTextStore *dt = nullptr;
    const float *const_color = nullptr;
    float const_wire = 0.0f;
    bool do_relations = false;
    bool transparent = false;
    bool show_relations = false;
    bool draw_envelope_distance = false;
    bool draw_relation_from_head = false;
    bool show_text = false;
    bool is_filled = false;
    const ThemeWireColor *bcolor = nullptr;
  };

  static void draw_armature_pose(Armatures::DrawContext *ctx);
  static void draw_armature_edit(Armatures::DrawContext *ctx);
};

}  // namespace overlay
}  // namespace blender::draw

namespace blender {

/* A part of an armature the overlay draws into a selection rectangle (gpu-select.cc). */
struct SelectHit {
  uint id;
  float depth;
  float distance;
};

/* A bone name the overlay draws (DRW_text_cache_add): where, in what color. */
struct DRWTextStore {
  struct Text {
    float3 co;
    uchar color[4];
    std::string name;
  };
  Vector<Text> texts;
};

static draw::overlay::Resources resources;
static DRWContext *draw_context = nullptr;

/* port-override: the draw manager's context, of what an armature's sync reads (the scene, the active object's mode). */
DRWContext::DRWContext(Mode mode, Depsgraph *depsgraph, const int2 /*size*/, const bContext *C, ARegion * /*region*/, View3D * /*v3d*/)
    : mode(mode)
{
  this->depsgraph = depsgraph;
  this->evil_C = C;
  scene = DEG_get_evaluated_scene(depsgraph);
  view_layer = DEG_get_evaluated_view_layer(depsgraph);
  BKE_view_layer_synced_ensure(*DEG_get_bmain(depsgraph), scene, view_layer);
  obact = BKE_view_layer_active_object_get(view_layer);
  object_mode = obact ? eObjectMode(obact->mode) : OB_MODE_OBJECT;
  object_pose = (object_mode & OB_MODE_POSE) ? obact : (object_mode & OB_MODE_ALL_WEIGHT_PAINT) ? BKE_object_pose_armature_get(obact) : nullptr;
  object_edit = (object_mode & OB_MODE_EDIT) ? obact : nullptr;
}
DRWContext::~DRWContext() = default;
const DRWContext *DRW_context_get() { return draw_context; }

/* port-override: the overlay's text store, read by armature_draw. */
void DRW_text_cache_add(DRWTextStore *dt, const float co[3], const char *str, const int str_len, short /*xoffs*/, short /*yoffs*/,
                        short /*flag*/, const uchar col[4], const bool /*shadow*/, const bool /*align_center*/)
{
  dt->texts.append({float3(co), {col[0], col[1], col[2], col[3]}, std::string(str, str_len)});
}

namespace draw {

/* port-override: a custom shape's batches are its mesh and what of it the overlay draws; Bylonder extracts them
 * (armature_shape_mesh). Curve and text shapes are not drawn. */
void DRW_mesh_batch_cache_validate(Mesh & /*mesh*/) {}
void drw_batch_cache_generate_requested_delayed(Object * /*ob*/) {}
void DRW_curve_batch_cache_validate(Curve * /*cu*/) {}
gpu::Batch *DRW_mesh_batch_cache_get_surface(Mesh &mesh) { return overlay::shape_batch(&mesh, overlay::ShapeGeometry::Surface); }
gpu::Batch *DRW_mesh_batch_cache_get_edge_detection(Mesh &mesh, bool * /*r_is_manifold*/)
{
  return overlay::shape_batch(&mesh, overlay::ShapeGeometry::EdgeDetection);
}
gpu::Batch *DRW_mesh_batch_cache_get_loose_edges(Mesh &mesh)
{
  return !mesh.loose_edges().is_empty() ? overlay::shape_batch(&mesh, overlay::ShapeGeometry::LooseEdges) : nullptr;
}
gpu::Batch *DRW_mesh_batch_cache_get_all_edges(Mesh &mesh) { return overlay::shape_batch(&mesh, overlay::ShapeGeometry::AllEdges); }
gpu::Batch *DRW_cache_curve_edge_wire_get(Object * /*ob*/) { return nullptr; }
gpu::Batch *DRW_cache_text_edge_wire_get(Object * /*ob*/) { return nullptr; }

}  // namespace draw
}  // namespace blender

#include "engines/overlay/overlay_armature.cc"

namespace blender {
using namespace draw::overlay;
using draw::ObjectRef;

/* blender-port: overlay_instance.cc Resources::update_theme_settings, the colors the armature overlay reads. */
static void update_theme_settings(UniformData &gb)
{
  ui::theme::theme_set(SPACE_VIEW3D, RGN_TYPE_WINDOW);
  auto rgba_uchar_to_float = [](uchar r, uchar g, uchar b, uchar a) { return float4(r, g, b, a) / 255.0f; };
  ui::theme::get_color_4fv(TH_WIRE, gb.colors.wire);
  ui::theme::get_color_4fv(TH_WIRE_EDIT, gb.colors.wire_edit);
  ui::theme::get_color_4fv(TH_ACTIVE, gb.colors.active_object);
  ui::theme::get_color_4fv(TH_SELECT, gb.colors.object_select);
  ui::theme::get_color_4fv(TH_TRANSFORM, gb.colors.transform);
  ui::theme::get_color_4fv(TH_VERTEX, gb.colors.vert);
  ui::theme::get_color_4fv(TH_VERTEX_SELECT, gb.colors.vert_select);
  ui::theme::get_color_4fv(TH_EDGE_SELECT, gb.colors.edge_select);
  ui::theme::get_color_4fv(TH_TEXT, gb.colors.text);
  ui::theme::get_color_4fv(TH_TEXT_HI, gb.colors.text_hi);
  ui::theme::get_color_4fv(TH_BONE_POSE, gb.colors.bone_pose);
  ui::theme::get_color_4fv(TH_BONE_POSE_ACTIVE, gb.colors.bone_pose_active);
  ui::theme::get_color_shade_4fv(TH_EDGE_SELECT, 60, gb.colors.bone_active);
  ui::theme::get_color_shade_4fv(TH_EDGE_SELECT, -20, gb.colors.bone_select);
  ui::theme::get_color_blend_shade_4fv(TH_WIRE, TH_BONE_POSE, 0.15f, 0, gb.colors.bone_pose_active_unsel);
  ui::theme::get_color_blend_shade_3fv(TH_WIRE_EDIT, TH_EDGE_SELECT, 0.15f, 0, gb.colors.bone_active_unsel);
  gb.colors.bone_pose_no_target = rgba_uchar_to_float(255, 150, 0, 80);
  gb.colors.bone_pose_ik = rgba_uchar_to_float(255, 255, 0, 80);
  gb.colors.bone_pose_spline_ik = rgba_uchar_to_float(200, 255, 0, 80);
  gb.colors.bone_pose_constraint = rgba_uchar_to_float(0, 255, 120, 80);
  ui::theme::get_color_4fv(TH_BONE_SOLID, gb.colors.bone_solid);
  ui::theme::get_color_4fv(TH_BONE_LOCKED_WEIGHT, gb.colors.bone_locked);
  gb.colors.bone_ik_line = float4(0.8f, 0.8f, 0.0f, 1.0f);
  gb.colors.bone_ik_line_no_target = float4(0.8f, 0.5f, 0.2f, 1.0f);
  gb.colors.bone_ik_line_spline = float4(0.8f, 0.8f, 0.2f, 1.0f);
  float4 *color = reinterpret_cast<float4 *>(&gb.colors);
  float4 *color_end = color + (sizeof(gb.colors) / sizeof(float4));
  do {
    srgb_to_linearrgb_v4(&color->x, &color->x);
  } while (++color < color_end);
}

/* The overlay's View3D settings an armature's sync reads (armature_draw's flags). */
enum {
  DRAW_SELECTING = 1 << 0,
  DRAW_TRANSPARENT = 1 << 1,
  DRAW_SHOW_RELATIONS = 1 << 2,
  DRAW_SHOW_OUTLINE = 1 << 3,
  DRAW_SHOW_TEXT = 1 << 4,
};

/* One buffer of instances: their count, the shader's per instance data, and a select id each. */
struct DrawBuffer {
  int count;
  const void *data;
  const uint32_t *ids;
};
enum {
  SPHERE_FILL,
  SPHERE_OUTLINE,
  OCTAHEDRAL_FILL,
  OCTAHEDRAL_OUTLINE,
  BBONES_FILL,
  BBONES_OUTLINE,
  ENVELOPE_FILL,
  ENVELOPE_OUTLINE,
  ENVELOPE_DISTANCE,
  STICK,
  WIRE,
  ARROWS,
  DEGREES_OF_FREEDOM_FILL,
  DEGREES_OF_FREEDOM_WIRE,
  RELATIONS,
  BUFFERS_NUM,
};
/* A custom shape's instances: the kind of pass (0 fill, 1 outline, 2 wire), what it draws and its instances. */
struct CustomShape {
  int pass;
  const Mesh *mesh;
  int geometry;
  DrawBuffer buffer;
};
struct BoneText {
  float co[3];
  uchar color[4];
  const char *name;
};
struct ArmatureDraw {
  /* Whether the instances are in the transparent passes (X-ray, or a wire object in Edit or Pose Mode). */
  int transparent;
  /* Whether it draws in front of the scene (the object's In Front). */
  int in_front;
  DrawBuffer buffers[BUFFERS_NUM];
  int customs_num;
  const CustomShape *customs;
  int texts_num;
  const BoneText *texts;
};

template<typename T> static DrawBuffer buffer_of(const T &buf) { return {int(buf.ids.size()), buf.data.data(), buf.ids.data()}; }

/* blender-port: overlay_armature.hh Armatures::is_pose_mode. */
static bool is_pose_mode(const Object *armature_ob)
{
  const Object *active_ob = draw_context->obact;
  const eObjectMode object_mode = draw_context->object_mode;
  if (((armature_ob == active_ob) || (armature_ob->mode & OB_MODE_POSE)) && ((object_mode & OB_MODE_POSE) != 0)) {
    return true;
  }
  return active_ob != nullptr && (object_mode & OB_MODE_ALL_WEIGHT_PAINT) &&
         armature_ob == BKE_object_pose_armature_get(const_cast<Object *>(active_ob));
}

/* blender-port: overlay_private.hh Resources::object_wire_theme_id and object_wire_color, for an armature. */
static const float *object_wire_color(const ObjectRef &ob_ref)
{
  const ThemeColors &colors = resources.theme.colors;
  const Object &ob = *ob_ref.object;
  const bool is_selected = ob.base_flag & BASE_SELECTED;
  if (ob.base_flag & BASE_FROM_SET) {
    return colors.wire;
  }
  if ((draw_context->object_mode & OB_MODE_EDIT) && (ob.mode & OB_MODE_EDIT)) {
    return colors.wire_edit;
  }
  if ((G.moving & G_TRANSFORM_OBJ) && is_selected) {
    return colors.transform;
  }
  if (is_selected) {
    return &ob == draw_context->obact ? colors.active_object : colors.object_select;
  }
  return colors.wire;
}

/* blender-port: overlay_armature.hh Armatures::create_draw_context, the view's settings given by flags. */
static Armatures::DrawContext create_draw_context(const ObjectRef &ob_ref, Armatures::BoneBuffers &bone_buf, DRWTextStore &dt,
                                                  eArmatureDrawMode draw_mode, int flags)
{
  bArmature &arm = DRW_object_get_data_for_drawing<bArmature>(*ob_ref.object);
  Armatures::DrawContext ctx;
  ctx.ob = ob_ref.object;
  ctx.ob_ref = &ob_ref;
  ctx.armature = &arm;
  ctx.res = &resources;
  ctx.dt = &dt;
  ctx.draw_mode = draw_mode;
  ctx.drawtype = eArmature_Drawtype(arm.drawtype);
  const bool draw_transparent = flags & DRAW_TRANSPARENT;
  const bool is_edit_or_pose_mode = draw_mode != ARM_DRAW_MODE_OBJECT;
  const bool draw_as_wire = (ctx.ob->dt < OB_SOLID);
  const bool is_transparent = draw_transparent || (draw_as_wire && is_edit_or_pose_mode);
  ctx.bone_buf = &bone_buf;
  ctx.transparent = is_transparent;
  ctx.is_filled = (!draw_transparent && !draw_as_wire) || is_edit_or_pose_mode;
  ctx.show_relations = (flags & DRAW_SHOW_RELATIONS) && !resources.is_selection();
  ctx.do_relations = ctx.show_relations && is_edit_or_pose_mode;
  ctx.draw_envelope_distance = is_edit_or_pose_mode;
  ctx.draw_relation_from_head = (arm.flag & ARM_DRAW_RELATION_FROM_HEAD);
  ctx.show_text = flags & DRAW_SHOW_TEXT;
  ctx.const_color = is_edit_or_pose_mode ? nullptr : object_wire_color(ob_ref);
  ctx.const_wire = (!ctx.is_filled || is_transparent) ? 1.0f : 0.0f;
  if ((ctx.ob->base_flag & BASE_SELECTED) && (flags & DRAW_SHOW_OUTLINE)) {
    ctx.const_wire = 1.5f;
  }
  return ctx;
}

/* blender-port: extract_mesh_ibo_lines_adjacency.cc lines_adjacency_triangle and create_lines_for_remaining_edges, on
 * the mesh's corner triangles: each edge as the corners (opposite, v1, v2, opposite) the outline shader reads. */
static void lines_adjacency(const Mesh &mesh, Vector<uint> &indices)
{
  constexpr int unset = INT_MAX, handled = INT_MAX - 1;
  const Span<int> corner_verts = mesh.corner_verts();
  Array<int> vert_to_corner(mesh.verts_num, 0);
  Map<OrderedEdge, int> edge_hash;
  const auto add = [&](uint a, uint b, uint c, uint d) { indices.extend({a, b, c, d}); };
  for (const int3 &tri : mesh.corner_tris()) {
    uint3 corner_tri(tri[0], tri[1], tri[2]);
    uint3 vert_tri(corner_verts[tri[0]], corner_verts[tri[1]], corner_verts[tri[2]]);
    const auto rotate = [](uint3 &value) { value = uint3(value[2], value[0], value[1]); };
    for (int e = 0; e < 3; e++) {
      rotate(vert_tri);
      rotate(corner_tri);
      const bool inv_indices = vert_tri[1] > vert_tri[2];
      const auto first = [&](int *value) {
        const int new_value = int(corner_tri[0]) + 1;
        *value = inv_indices ? -new_value : new_value;
        vert_to_corner[vert_tri[1]] = corner_tri[1];
        vert_to_corner[vert_tri[2]] = corner_tri[2];
      };
      edge_hash.add_or_modify({int(vert_tri[1]), int(vert_tri[2])}, first, [&](int *value) {
        const int v_data = *value;
        if (v_data == unset) {
          first(value);
        }
        else if (v_data != handled) {
          *value = handled;
          const bool inv_opposite = v_data < 0;
          const uint corner_opposite = abs(v_data) - 1;
          if (inv_opposite == inv_indices) {
            add(corner_tri[0], corner_tri[1], corner_tri[2], corner_tri[0]);
            add(corner_opposite, corner_tri[1], corner_tri[2], corner_opposite);
          }
          else {
            add(corner_tri[0], corner_tri[1], corner_tri[2], corner_opposite);
          }
        }
      });
    }
  }
  for (const auto item : edge_hash.items()) {
    const int v_data = item.value;
    if (v_data >= handled) {
      continue;
    }
    int v2 = item.key.v_low, v3 = item.key.v_high;
    const uint l1 = uint(abs(v_data)) - 1;
    if (v_data < 0) {
      std::swap(v2, v3);
    }
    add(l1, vert_to_corner[v2], vert_to_corner[v3], l1);
  }
}

/* A custom shape's mesh as the batch armature_draw names draws it (ShapeGeometry): its points (per corner for the
 * surface and the edge detection, with the corners' normals for the surface, else per vertex) and the indices of its
 * triangles, line adjacencies or lines; valid until the next call. */
struct ShapeMesh {
  int points_num;
  const float3 *positions;
  const float3 *normals;
  int indices_num;
  const uint *indices;
};
EXPORT(armature_shape_mesh) const ShapeMesh *armature_shape_mesh(const Mesh *mesh, int geometry)
{
  static ShapeMesh header;
  static Vector<float3> positions, normals;
  static Vector<uint> indices;
  positions.clear();
  normals.clear();
  indices.clear();
  const Span<float3> vert_positions = mesh->vert_positions();
  const bool per_corner = ELEM(ShapeGeometry(geometry), ShapeGeometry::Surface, ShapeGeometry::EdgeDetection);
  if (per_corner) {
    for (const int vert : mesh->corner_verts()) {
      positions.append(vert_positions[vert]);
    }
  }
  else {
    positions.extend(vert_positions);
  }
  switch (ShapeGeometry(geometry)) {
    case ShapeGeometry::Surface:
      normals.extend(mesh->corner_normals());
      for (const int3 &tri : mesh->corner_tris()) {
        indices.extend({uint(tri[0]), uint(tri[1]), uint(tri[2])});
      }
      break;
    case ShapeGeometry::EdgeDetection:
      lines_adjacency(*mesh, indices);
      break;
    case ShapeGeometry::LooseEdges:
    case ShapeGeometry::AllEdges: {
      const Span<int2> edges = mesh->edges();
      const auto add_edge = [&](const int64_t i) { indices.extend({uint(edges[i][0]), uint(edges[i][1])}); };
      if (ShapeGeometry(geometry) == ShapeGeometry::LooseEdges) {
        mesh->loose_edges().foreach_index(add_edge);
      }
      else {
        for (const int64_t i : edges.index_range()) {
          add_edge(i);
        }
      }
      break;
    }
    default:
      break;
  }
  header = {int(positions.size()), positions.data(), normals.data(), int(indices.size()), indices.data()};
  return &header;
}

/* The overlay's sync of an armature object (edit_object_sync in Edit Mode, else object_sync) into `bb` and `dt`; returns
 * whether its instances are in the transparent passes. */
static bool armature_sync(Depsgraph *depsgraph, Object *ob, int flags, Armatures::BoneBuffers &bb, DRWTextStore &dt)
{
  DRWContext context(DRWContext::VIEWPORT, depsgraph, int2(1, 1));
  draw_context = &context;
  resources.selecting = flags & DRAW_SELECTING;
  update_theme_settings(resources.theme);
  Object *evaluated = DEG_get_evaluated(depsgraph, ob);
  const ObjectRef ob_ref{evaluated};
  bArmature &arm = *id_cast<bArmature *>(ob->data);
  Armatures::DrawContext ctx;
  if (arm.edbo) {
    ctx = create_draw_context(ob_ref, bb, dt, ARM_DRAW_MODE_EDIT, flags);
    Armatures::draw_armature_edit(&ctx);
  }
  else if (evaluated->pose) {
    ctx = create_draw_context(ob_ref, bb, dt, is_pose_mode(evaluated) ? ARM_DRAW_MODE_POSE : ARM_DRAW_MODE_OBJECT, flags);
    Armatures::draw_armature_pose(&ctx);
  }
  draw_context = nullptr;
  return ctx.transparent;
}

/* What the overlay draws of an armature object in the view, synced as Blender's overlay syncs it, valid until the next
 * call. */
EXPORT(armature_draw) const ArmatureDraw *armature_draw(bContext *C, Object *ob, int flags)
{
  static ArmatureDraw header;
  static std::unique_ptr<Armatures::BoneBuffers> buffers;
  static DRWTextStore dt;
  static Vector<CustomShape> customs;
  static Vector<BoneText> texts;
  buffers = std::make_unique<Armatures::BoneBuffers>(SelectionType::ENABLED);
  dt.texts.clear();
  customs.clear();
  texts.clear();
  Armatures::BoneBuffers &bb = *buffers;
  header.transparent = armature_sync(CTX_data_depsgraph_pointer(C), ob, flags, bb, dt);
  header.in_front = (ob->dtx & OB_DRAW_IN_FRONT) != 0;
  header.buffers[SPHERE_FILL] = buffer_of(bb.sphere_fill_buf);
  header.buffers[SPHERE_OUTLINE] = buffer_of(bb.sphere_outline_buf);
  header.buffers[OCTAHEDRAL_FILL] = buffer_of(bb.octahedral_fill_buf);
  header.buffers[OCTAHEDRAL_OUTLINE] = buffer_of(bb.octahedral_outline_buf);
  header.buffers[BBONES_FILL] = buffer_of(bb.bbones_fill_buf);
  header.buffers[BBONES_OUTLINE] = buffer_of(bb.bbones_outline_buf);
  header.buffers[ENVELOPE_FILL] = buffer_of(bb.envelope_fill_buf);
  header.buffers[ENVELOPE_OUTLINE] = buffer_of(bb.envelope_outline_buf);
  header.buffers[ENVELOPE_DISTANCE] = buffer_of(bb.envelope_distance_buf);
  header.buffers[STICK] = buffer_of(bb.stick_buf);
  header.buffers[WIRE] = buffer_of(bb.wire_buf);
  header.buffers[ARROWS] = buffer_of(bb.arrows_buf);
  header.buffers[DEGREES_OF_FREEDOM_FILL] = buffer_of(bb.degrees_of_freedom_fill_buf);
  header.buffers[DEGREES_OF_FREEDOM_WIRE] = buffer_of(bb.degrees_of_freedom_wire_buf);
  header.buffers[RELATIONS] = buffer_of(bb.relations_buf);
  const auto add_customs = [&](int pass, const Map<gpu::Batch *, std::unique_ptr<Armatures::BoneInstanceBuf>> &map) {
    for (const auto item : map.items()) {
      const ShapeBatch &shape = batch_shape(item.key);
      customs.append({pass, shape.mesh, int(shape.geometry), buffer_of(*item.value)});
    }
  };
  add_customs(0, bb.custom_shape_fill);
  add_customs(1, bb.custom_shape_outline);
  add_customs(2, bb.custom_shape_wire);
  for (const DRWTextStore::Text &text : dt.texts) {
    texts.append({{text.co.x, text.co.y, text.co.z}, {text.color[0], text.color[1], text.color[2], text.color[3]}, text.name.c_str()});
  }
  header.customs_num = customs.size();
  header.customs = customs.data();
  header.texts_num = texts.size();
  header.texts = texts.data();
  return &header;
}

/* Selection: what the GPU would rasterize of each drawn instance into a selection rectangle, from the same buffers
 * (port-override: the module has no GPU selection buffer, gpu-select.cc). Each instance is projected into the view as
 * triangles (the solid shapes), capsules (sticks, wires, edges, envelopes' bodies) and discs (joints, envelopes' ends),
 * in region pixels with their depth. */

/* blender-port: overlay_shape.cc bone_octahedral_verts, bone_octahedral_solid_tris, bone_box_verts, bone_box_solid_tris. */
static const float3 octahedral_verts[6] = {{0, 0, 0}, {0.1f, 0.1f, 0.1f}, {0.1f, 0.1f, -0.1f}, {-0.1f, 0.1f, -0.1f}, {-0.1f, 0.1f, 0.1f}, {0, 1, 0}};
static const int3 octahedral_tris[8] = {{2, 1, 0}, {3, 2, 0}, {4, 3, 0}, {1, 4, 0}, {5, 1, 2}, {5, 2, 3}, {5, 3, 4}, {5, 4, 1}};
static const float3 box_verts[8] = {{1, 0, 1}, {1, 0, -1}, {-1, 0, -1}, {-1, 0, 1}, {1, 1, 1}, {1, 1, -1}, {-1, 1, -1}, {-1, 1, 1}};
static const int3 box_tris[12] = {{0, 2, 1}, {0, 3, 2}, {0, 1, 5}, {0, 5, 4}, {1, 2, 6}, {1, 6, 5},
                                  {2, 3, 7}, {2, 7, 6}, {3, 0, 4}, {3, 4, 7}, {4, 5, 6}, {4, 6, 7}};
/* overlay_armature_stick_vert.glsl's size of a stick in pixels. */
static constexpr float stick_size = 5.0f;

/* The view's projection of world points into region pixels and depth (0 to 1), as the GPU rasterizes them. */
struct Projection {
  float4x4 persmat;
  float3 right;
  float2 size;

  float3 point(const float3 &co) const
  {
    const float4 v = persmat * float4(co, 1.0f);
    const float3 ndc = v.xyz() / v.w;
    return {(ndc.x + 1.0f) * 0.5f * size.x, (ndc.y + 1.0f) * 0.5f * size.y, (ndc.z + 1.0f) * 0.5f};
  }
  /* A world radius at a point, in pixels. */
  float pixels(const float3 &co, float radius) const { return math::distance(point(co).xy(), point(co + right * radius).xy()); }
};

static float segment_distance(const float2 &p, const float2 &a, const float2 &b)
{
  const float2 d = b - a;
  const float length2 = math::length_squared(d);
  const float t = length2 > 0.0f ? std::clamp(math::dot(p - a, d) / length2, 0.0f, 1.0f) : 0.0f;
  return math::distance(p, a + d * t);
}

/* What a selection rectangle catches of an instance: whether any of its pixels, and of those the nearest depth and
 * distance in pixels to the rectangle's center; only pixels within `radius` of the center when it is not 0 (a circle). */
struct Catch {
  rctf rect;
  float2 center;
  float radius = 0.0f;
  bool hit = false;
  float depth = 1.0f;
  float distance = FLT_MAX;

  void add(float to_center, bool in_rect, Span<float3> points)
  {
    if (!(radius > 0.0f ? to_center <= radius : in_rect)) {
      return;
    }
    hit = true;
    distance = std::min(distance, to_center);
    for (const float3 &p : points) {
      depth = std::min(depth, p.z);
    }
  }
  float rect_distance(const float2 &p) const
  {
    return math::distance(p, float2(std::clamp(p.x, rect.xmin, rect.xmax), std::clamp(p.y, rect.ymin, rect.ymax)));
  }
  void triangle(const float3 &a, const float3 &b, const float3 &c)
  {
    const float2 v[3] = {a.xy(), b.xy(), c.xy()};
    const auto side = [&](const float2 &p, int i) {
      const float2 e = v[(i + 1) % 3] - v[i];
      return e.x * (p.y - v[i].y) - e.y * (p.x - v[i].x);
    };
    const auto contains = [&](const float2 &p) {
      const float s0 = side(p, 0), s1 = side(p, 1), s2 = side(p, 2);
      return (s0 >= 0 && s1 >= 0 && s2 >= 0) || (s0 <= 0 && s1 <= 0 && s2 <= 0);
    };
    bool in_rect = contains(float2(rect.xmin, rect.ymin)) || contains(float2(rect.xmax, rect.ymax)) ||
                   contains(float2(rect.xmin, rect.ymax)) || contains(float2(rect.xmax, rect.ymin));
    float to_center = contains(center) ? 0.0f : FLT_MAX;
    for (int i = 0; i < 3; i++) {
      in_rect |= BLI_rctf_isect_segment(&rect, v[i], v[(i + 1) % 3]);
      to_center = std::min(to_center, segment_distance(center, v[i], v[(i + 1) % 3]));
    }
    add(to_center, in_rect, {a, b, c});
  }
  void capsule(const float3 &a, const float3 &b, float width)
  {
    const float2 corners[4] = {{rect.xmin, rect.ymin}, {rect.xmax, rect.ymin}, {rect.xmax, rect.ymax}, {rect.xmin, rect.ymax}};
    float to_rect = BLI_rctf_isect_segment(&rect, a.xy(), b.xy()) ? 0.0f : std::min(rect_distance(a.xy()), rect_distance(b.xy()));
    for (const float2 &corner : corners) {
      to_rect = std::min(to_rect, segment_distance(corner, a.xy(), b.xy()));
    }
    add(std::max(0.0f, segment_distance(center, a.xy(), b.xy()) - width), to_rect <= width, {a, b});
  }
  void disc(const float3 &c, float r) { add(std::max(0.0f, math::distance(center, c.xy()) - r), rect_distance(c.xy()) <= r, {c}); }
};

/* An instance's matrix without the colors packed in its fourth row (overlay_common_lib.glsl extract_matrix_packed_data). */
static float4x4 unpacked(const BoneInstanceData &instance)
{
  float4x4 m = instance.mat44;
  m[0][3] = m[1][3] = m[2][3] = 0.0f;
  m[3][3] = 1.0f;
  return m;
}

/* Each instance of an armature's sync a region catches: fn(its select id, what it caught). */
static void select_catches(Armatures::BoneBuffers &bb, const Projection &view, const Catch &region, FunctionRef<void(uint32_t, const Catch &)> fn)
{
  const auto each = [&](const auto &buf, const auto &shape) {
    for (const int i : buf.ids.index_range()) {
      Catch c = region;
      shape(buf.data[i], c);
      if (c.hit) {
        fn(buf.ids[i], c);
      }
    }
  };
  const auto solid = [&](Span<float3> verts, Span<int3> tris) {
    return [&view, verts, tris](const BoneInstanceData &instance, Catch &c) {
      const float4x4 m = unpacked(instance);
      const auto at = [&](int v) { return view.point(math::transform_point(m, verts[v])); };
      for (const int3 &tri : tris) {
        c.triangle(at(tri.x), at(tri.y), at(tri.z));
      }
    };
  };
  each(bb.octahedral_fill_buf, solid(Span(octahedral_verts, 6), Span(octahedral_tris, 8)));
  each(bb.bbones_fill_buf, solid(Span(box_verts, 8), Span(box_tris, 12)));
  each(bb.sphere_fill_buf, [&](const BoneInstanceData &instance, Catch &c) {
    const float4x4 m = unpacked(instance);
    c.disc(view.point(m.location()), view.pixels(m.location(), 0.05f * math::length(m.x_axis())));
  });
  each(bb.envelope_fill_buf, [&](const BoneEnvelopeData &envelope, Catch &c) {
    const float3 head = envelope.head_sphere.xyz(), tail = envelope.tail_sphere.xyz();
    const float rh = view.pixels(head, envelope.head_sphere.w), rt = view.pixels(tail, envelope.tail_sphere.w);
    c.disc(view.point(head), rh);
    c.disc(view.point(tail), rt);
    c.capsule(view.point(head), view.point(tail), std::min(rh, rt));
  });
  each(bb.stick_buf, [&](const BoneStickData &stick, Catch &c) {
    /* overlay_armature_stick_vert.glsl: thinner without a wire color; the body a band, the ends discs. */
    const float scale = (stick.wire_color.w > 0.0f ? 1.0f : 0.5f) * stick_size / 2.0f;
    const float3 start = view.point(stick.bone_start.xyz()), end = view.point(stick.bone_end.xyz());
    if (stick.bone_color.w > 0.0f) {
      c.capsule(start, end, scale);
    }
    if (stick.head_color.w > 0.0f) {
      c.disc(start, 2.0f * scale);
    }
    if (stick.tail_color.w > 0.0f) {
      c.disc(end, 2.0f * scale);
    }
  });
  for (const int i : bb.wire_buf.ids.index_range()) {
    Catch c = region;
    c.capsule(view.point(bb.wire_buf.data[i * 2].pos_.xyz()), view.point(bb.wire_buf.data[i * 2 + 1].pos_.xyz()), 1.0f);
    if (c.hit) {
      fn(bb.wire_buf.ids[i], c);
    }
  }
  const auto custom = [&](const Map<gpu::Batch *, std::unique_ptr<Armatures::BoneInstanceBuf>> &map) {
    for (const auto item : map.items()) {
      const ShapeBatch &shape = batch_shape(item.key);
      each(*item.value, [&](const BoneInstanceData &instance, Catch &c) {
        const float4x4 m = unpacked(instance);
        const auto at = [&](const float3 &co) { return view.point(math::transform_point(m, co)); };
        if (!shape.mesh) {
          /* An empty's shape, caught by its axes. */
          for (const float3 &axis : {float3(1, 0, 0), float3(0, 1, 0), float3(0, 0, 1)}) {
            c.capsule(at(-axis), at(axis), 1.0f);
          }
          return;
        }
        const Span<float3> positions = shape.mesh->vert_positions();
        if (shape.geometry == ShapeGeometry::Surface) {
          const Span<int> corner_verts = shape.mesh->corner_verts();
          for (const int3 &tri : shape.mesh->corner_tris()) {
            c.triangle(at(positions[corner_verts[tri.x]]), at(positions[corner_verts[tri.y]]), at(positions[corner_verts[tri.z]]));
          }
          return;
        }
        for (const int2 &edge : shape.mesh->edges()) {
          c.capsule(at(positions[edge.x]), at(positions[edge.y]), 1.0f);
        }
      });
    }
  };
  custom(bb.custom_shape_fill);
  custom(bb.custom_shape_wire);
}

static Projection projection_of(const RegionView3D &rv3d, int winx, int winy)
{
  return {float4x4(rv3d.persmat), math::normalize(float3(rv3d.viewinv[0])), float2(winx, winy)};
}

static Catch rect_catch(const rctf &rect, float radius)
{
  Catch region;
  region.rect = rect;
  region.center = float2(BLI_rctf_cent_x(&rect), BLI_rctf_cent_y(&rect));
  region.radius = radius;
  return region;
}

/* The parts of an armature in Edit or Pose Mode drawn into a selection rectangle of the view (in region pixels; a
 * circle of `radius` about its center when not 0), as the select engine finds them, for gpu-select.cc's draw loop.
 * Blender's overlay draws an armature's select ids with the object's (select_instance.hh SelectMap::select_id), and
 * In Front ones as nearer (read_result). */
void armature_select_hits(Depsgraph *depsgraph, Object *ob, const RegionView3D &rv3d, int winx, int winy, const rcti &rect, int radius,
                          Vector<SelectHit> &hits)
{
  Armatures::BoneBuffers bb(SelectionType::ENABLED);
  DRWTextStore dt;
  armature_sync(depsgraph, ob, DRAW_SELECTING, bb, dt);
  rctf region;
  BLI_rctf_rcti_copy(&region, &rect);
  const float in_front = (ob->dtx & OB_DRAW_IN_FRONT) ? 0.01f : 1.0f;
  Map<uint32_t, SelectHit> by_id;
  select_catches(bb, projection_of(rv3d, winx, winy), rect_catch(region, float(radius)), [&](uint32_t id, const Catch &c) {
    if (id == uint32_t(-1)) {
      return;
    }
    SelectHit &hit = by_id.lookup_or_add(id, {ob->runtime->select_id | id, 1.0f, FLT_MAX});
    hit.depth = std::min(hit.depth, c.depth * in_front);
    hit.distance = std::min(hit.distance, c.distance);
  });
  for (const SelectHit &hit : by_id.values()) {
    hits.append(hit);
  }
}

/* The depth at which a click at (x, y) in region pixels of a view (its matrices as main_view_set takes them) hits the
 * bones an armature draws in Object Mode, or -1: within 5 pixels, as a click picks objects (view3d_select.cc
 * mixed_bones_object_selectbuffer's smallest rectangle). */
EXPORT(armature_pick_depth)
float armature_pick_depth(bContext *C, Object *ob, const float *viewmat, const float *winmat, int winx, int winy, float x, float y)
{
  RegionView3D rv3d = {};
  view3d_matrices_set(rv3d, viewmat, winmat, winx, winy, true);
  Armatures::BoneBuffers bb(SelectionType::ENABLED);
  DRWTextStore dt;
  armature_sync(CTX_data_depsgraph_pointer(C), ob, 0, bb, dt);
  rctf region;
  BLI_rctf_init(&region, x - 5, x + 5, y - 5, y + 5);
  float depth = -1.0f;
  select_catches(bb, projection_of(rv3d, winx, winy), rect_catch(region, 0.0f), [&](uint32_t, const Catch &c) {
    depth = depth < 0.0f ? c.depth : std::min(depth, c.depth);
  });
  return depth;
}

}  // namespace blender
