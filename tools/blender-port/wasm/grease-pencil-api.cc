/* Grease Pencil objects as Blender's draw cache reads them (draw_cache_impl_grease_pencil.cc grease_pencil_geom_batch_ensure
 * and the engine's layer setup, gpencil_cache_utils.cc), for Babylon to draw (src/draw/grease-pencil.js): every visible
 * drawing of every visible Grease Pencil object, onion skins included, evaluated with its modifiers. A drawing whose
 * source data, materials and layer settings did not change since the last call is reported unchanged and not packed
 * again, so drawing a stroke packs only the drawing it is drawn into. */
#include "BKE_attribute.hh"
#include "BKE_main.hh"
#include "BKE_context.hh"
#include "BKE_curves.hh"
#include "BKE_deform.hh"
#include "BKE_grease_pencil.hh"
#include "BKE_layer.hh"
#include "BKE_material.hh"
#include "BKE_object.hh"
#include "BKE_object_deform.h"
#include "BLI_hash_mm2a.hh"
#include "BLI_listbase.h"
#include "BLI_map.hh"
#include "BLI_math_color.h"
#include "BLI_math_matrix.hh"
#include "DEG_depsgraph_query.hh"
#include "DNA_grease_pencil_types.h"
#include "DNA_material_types.h"
#include "DNA_object_types.h"
#include "DNA_scene_types.h"
#include "ED_grease_pencil.hh"
#include "UI_resources.hh"

using namespace blender;

#define EXPORT(name) extern "C" __attribute__((export_name(#name)))

/* A visible drawing: { ob (Main's object), layer (its index), onion (0 the current frame, else the onion skin's
 * distance before or after it), changed (packed anew; else the last packing stands), blend (the layer's blend mode),
 * points_shown (Edit Mode's points are drawn: overlay_grease_pencil.hh, not in stroke select mode), first curve, curves,
 * first point, points, first triangle, triangles, layer_to_world (Blender's axes, column-major) }. */
struct GreasePencilDraw {
  Object *ob;
  int layer, onion, changed, blend, points_shown;
  int first_curve, curves, first_point, points, first_triangle, triangles;
  float layer_to_world[16];
};
/* A curve: its first point (in its drawing's), points, flags, material index, and a hash of what is packed of it. */
enum { CURVE_CYCLIC = 1, CURVE_STROKE = 2, CURVE_FILL = 4, CURVE_ROUND_START = 8, CURVE_ROUND_END = 16 };
constexpr int CURVE_INTS = 5;
/* A point: position (Babylon's axes: Blender's x, z, y, layer space), radius, stroke color, fill color (both display
 * colors, alpha not premultiplied), selection and the active vertex group's weight. */
constexpr int POINT_FLOATS = 14;

static Vector<GreasePencilDraw> draws;
static Vector<int> curve_data;
static Vector<float> point_data;
static Vector<uint32_t> triangle_data;
/* The last packing's hash of each drawing, by object, layer and onion skin. */
struct DrawKey {
  const Object *ob;
  int layer, onion;
  uint64_t hash() const { return get_default_hash(ob, layer, onion); }
  friend bool operator==(const DrawKey &a, const DrawKey &b) = default;
};
static Map<DrawKey, uint32_t> packed;

static void hash_span(BLI_HashMurmur2A &hash, const GSpan span)
{
  BLI_hash_mm2a_add(&hash, static_cast<const unsigned char *>(span.data()), span.size_in_bytes());
}
template<typename T> static void hash_value(BLI_HashMurmur2A &hash, const T &value)
{
  BLI_hash_mm2a_add(&hash, reinterpret_cast<const unsigned char *>(&value), sizeof(T));
}

/* What a drawing's packing depends on: its curves' data, the materials, the layer's settings and the mode. */
static uint32_t drawing_hash(const Object &ob, const bke::CurvesGeometry &curves, const float4 &tint, float opacity, int selectmode)
{
  BLI_HashMurmur2A hash;
  BLI_hash_mm2a_init(&hash, 0);
  hash_value(hash, curves.points_num());
  hash_value(hash, curves.curves_num());
  hash_span(hash, curves.offsets());
  curves.attributes().foreach_attribute([&](const bke::AttributeIter &iter) {
    hash_value(hash, BLI_hash_mm2(reinterpret_cast<const unsigned char *>(iter.name.c_str()), iter.name.size(), 0));
    const GVArray values = *iter.get();
    if (values.is_span()) {
      hash_span(hash, values.get_internal_span());
    }
    else {
      hash_value(hash, values.size());
    }
  });
  for (const int i : IndexRange(ob.totcol)) {
    const Material *ma = BKE_object_material_get(const_cast<Object *>(&ob), i + 1);
    if (ma && ma->gp_style) {
      hash_value(hash, *ma->gp_style);
    }
  }
  hash_value(hash, tint);
  hash_value(hash, opacity);
  hash_value(hash, ob.mode);
  hash_value(hash, selectmode);
  hash_value(hash, BKE_object_defgroup_active_index_get(&ob));
  return BLI_hash_mm2a_end(&hash);
}

/* blender-port: gpencil_vert.glsl gpencil_color_output, the mixed color (no texture). */
static float4 color_output(float4 color, const float4 vertex_color, const float strength, const float4 &tint, const float layer_alpha)
{
  float3 rgb = math::interpolate(float3(color), float3(vertex_color), vertex_color.w);
  rgb = math::interpolate(rgb, float3(tint), tint.w);
  float3 display;
  linearrgb_to_srgb_v3_v3(display, rgb);
  return float4(display, color.w * strength * layer_alpha);
}

/* blender-port: gpencil_cache_utils.cc grease_pencil_layer_final_tint_and_alpha_get, an onion skin's tint and alpha. */
static float4 onion_tint(const GreasePencil &grease_pencil, const int onion_id, float &r_alpha)
{
  r_alpha = 1.0f;
  if (onion_id == 0) {
    return float4(0.0f);
  }
  const GreasePencilOnionSkinningSettings &settings = grease_pencil.onion_skinning_settings;
  float3 color;
  if (settings.flag & GP_ONION_SKINNING_USE_CUSTOM_COLORS) {
    color = float3(onion_id > 0 ? settings.color_after : settings.color_before);
  }
  else {
    ui::theme::get_color_3fv(onion_id > 0 ? TH_FRAME_AFTER : TH_FRAME_BEFORE, color);
  }
  r_alpha = (settings.flag & GP_ONION_SKINNING_USE_FADE) ? 1.0f / abs(onion_id) : 1.0f;
  r_alpha *= settings.opacity;
  r_alpha = settings.opacity > 0.0f ? clamp_f(r_alpha, 0.1f, 1.0f) : clamp_f(r_alpha, 0.01f, 1.0f);
  return float4(color, 1.0f);
}

static const MaterialGPencilStyle *material_style(Object &ob, const int index)
{
  return BKE_gpencil_material_settings(&ob, std::max(index, 0) + 1);
}

/* A point attribute at the evaluated points (a Bezier or NURBS stroke's). */
template<typename T> static Array<T> evaluated_values(const bke::CurvesGeometry &curves, const VArray<T> &values)
{
  Array<T> result(curves.evaluated_points_num());
  curves.interpolate_to_evaluated(VArraySpan<T>(values), result.as_mutable_span());
  return result;
}

/* A drawing's curves, points and fill triangles, as the draw cache populates its vertex and index buffers. */
static void pack_drawing(Object &ob, const bke::greasepencil::Drawing &drawing, const float4 &tint, const float layer_alpha,
                         GreasePencilDraw &draw)
{
  const bke::CurvesGeometry &curves = drawing.strokes();
  const bke::AttributeAccessor attributes = curves.attributes();
  curves.ensure_can_interpolate_to_evaluated();
  const OffsetIndices<int> points_by_curve = curves.evaluated_points_by_curve();
  const Span<float3> positions = curves.evaluated_positions();
  const Array<float> radii = evaluated_values(curves, drawing.radii());
  const Array<float> opacities = evaluated_values(curves, drawing.opacities());
  const Array<ColorGeometry4f> vertex_colors = evaluated_values(curves, drawing.vertex_colors());
  const Array<float> selection = evaluated_values(curves, *attributes.lookup_or_default<float>(".selection", bke::AttrDomain::Point, 1.0f));
  const bDeformGroup *group = static_cast<const bDeformGroup *>(
      BLI_findlink(BKE_object_defgroup_list(&ob), BKE_object_defgroup_active_index_get(&ob) - 1));
  const Array<float> weights = evaluated_values(curves, *attributes.lookup_or_default<float>(
      ob.mode == OB_MODE_WEIGHT_GREASE_PENCIL && group ? group->name : "", bke::AttrDomain::Point, 0.0f));
  const VArray<bool> cyclic = curves.cyclic();
  const VArray<int8_t> start_caps = *attributes.lookup_or_default<int8_t>("start_cap", bke::AttrDomain::Curve, GP_STROKE_CAP_TYPE_ROUND);
  const VArray<int8_t> end_caps = *attributes.lookup_or_default<int8_t>("end_cap", bke::AttrDomain::Curve, GP_STROKE_CAP_TYPE_ROUND);
  const VArray<int> materials = *attributes.lookup_or_default<int>("material_index", bke::AttrDomain::Curve, 0);
  const VArray<bool> hide_strokes = *attributes.lookup_or_default<bool>("hide_stroke", bke::AttrDomain::Curve, false);
  const VArray<ColorGeometry4f> fill_colors = drawing.fill_colors();
  const VArray<float> fill_opacities = *attributes.lookup_or_default<float>("fill_opacity", bke::AttrDomain::Curve, 1.0f);

  draw.first_curve = curve_data.size() / CURVE_INTS;
  draw.first_point = point_data.size() / POINT_FLOATS;
  draw.first_triangle = triangle_data.size() / 3;
  for (const int curve : curves.curves_range()) {
    const IndexRange points = points_by_curve[curve];
    const MaterialGPencilStyle *style = material_style(ob, materials[curve]);
    const bool hidden = !style || (style->flag & GP_MATERIAL_HIDE);
    const int flags = (cyclic[curve] && points.size() > 2 ? CURVE_CYCLIC : 0) |
                      (hidden || hide_strokes[curve] ? 0 : CURVE_STROKE) | (hidden ? 0 : CURVE_FILL) |
                      (start_caps[curve] == GP_STROKE_CAP_TYPE_ROUND ? CURVE_ROUND_START : 0) |
                      (end_caps[curve] == GP_STROKE_CAP_TYPE_ROUND ? CURVE_ROUND_END : 0);
    const int first = point_data.size() / POINT_FLOATS - draw.first_point;
    const float4 stroke = style ? float4(style->stroke_rgba) : float4(0.0f);
    /* blender-port: gpencil_vert.glsl main, a fill's color and opacity (solid). */
    float4 fill = style ? float4(style->fill_rgba) : float4(0.0f);
    const float fill_opacity = fill_opacities[curve];
    fill.w = clamp_f(fill.w * fill_opacity + std::max(fill_opacity - 1.0f, 0.0f), 0.0f, 1.0f);
    const float4 fill_color = color_output(fill, float4(fill_colors[curve]), 1.0f, tint, layer_alpha);
    for (const int i : points) {
      const float4 color = color_output(stroke, float4(vertex_colors[i]), opacities[i], tint, layer_alpha);
      const float3 &p = positions[i];
      point_data.extend({p.x, p.z, p.y, std::max(radii[i], 0.0f), color.x, color.y, color.z, color.w,
                         fill_color.x, fill_color.y, fill_color.z, fill_color.w, selection[i], weights[i]});
    }
    BLI_HashMurmur2A hash;
    BLI_hash_mm2a_init(&hash, flags);
    BLI_hash_mm2a_add(&hash, reinterpret_cast<const unsigned char *>(&point_data[(draw.first_point + first) * POINT_FLOATS]),
                      points.size() * POINT_FLOATS * sizeof(float));
    curve_data.extend({first, int(points.size()), flags, materials[curve], int(BLI_hash_mm2a_end(&hash))});
  }
  /* Each fill's triangles, its points those of its curves in turn (grease_pencil_geom_batch_ensure point_to_id). */
  const std::optional<GroupedSpan<int>> fills = drawing.fills();
  const std::optional<GroupedSpan<int3>> triangles = drawing.triangles();
  if (fills && triangles) {
    for (const int fill_index : fills->index_range()) {
      const Span<int> fill = (*fills)[fill_index];
      if (!(curve_data[(draw.first_curve + fill.first()) * CURVE_INTS + 2] & CURVE_FILL)) {
        continue;
      }
      Vector<int> point_of(0);
      for (const int curve : fill) {
        for (const int i : points_by_curve[curve]) {
          point_of.append(i);
        }
      }
      for (const int3 tri : (*triangles)[fill_index]) {
        triangle_data.extend({uint32_t(point_of[tri.x]), uint32_t(point_of[tri.y]), uint32_t(point_of[tri.z])});
      }
    }
  }
  draw.curves = curve_data.size() / CURVE_INTS - draw.first_curve;
  draw.points = point_data.size() / POINT_FLOATS - draw.first_point;
  draw.triangles = triangle_data.size() / 3 - draw.first_triangle;
}

/* The visible drawings of Main's visible Grease Pencil objects (onion skins where `onion`), packed where they changed
 * since the last call (all of them with `repack`); returns their count. */
EXPORT(main_grease_pencil) int main_grease_pencil(bContext *C, bool onion, bool repack)
{
  draws.clear();
  curve_data.clear();
  point_data.clear();
  triangle_data.clear();
  if (repack) {
    packed.clear();
  }
  Depsgraph *depsgraph = CTX_data_depsgraph_pointer(C);
  const Scene &scene = *CTX_data_scene(C);
  ViewLayer *view_layer = CTX_data_view_layer(C);
  BKE_view_layer_synced_ensure(*CTX_data_main(C), &scene, view_layer);
  Set<DrawKey> seen;
  for (Base &base : *BKE_view_layer_object_bases_get(view_layer)) {
    Object &ob = *base.object;
    if (ob.type != OB_GREASE_PENCIL || !(base.flag & BASE_ENABLED_AND_VISIBLE_IN_DEFAULT_VIEWPORT)) {
      continue;
    }
    Object *evaluated = DEG_get_evaluated(depsgraph, &ob);
    const GreasePencil &grease_pencil = *reinterpret_cast<const GreasePencil *>(evaluated->data);
    for (const ed::greasepencil::DrawingInfo &info : ed::greasepencil::retrieve_visible_drawings(scene, grease_pencil, onion)) {
      const bke::greasepencil::Layer &layer = grease_pencil.layer(info.layer_index);
      float layer_alpha;
      const float4 tint = onion_tint(grease_pencil, info.onion_id, layer_alpha);
      layer_alpha *= layer.opacity;
      const bool points_shown = (ob.mode & OB_MODE_EDIT) && info.onion_id == 0 && scene.toolsettings->gpencil_selectmode_edit != GP_SELECTMODE_STROKE;
      GreasePencilDraw draw = {&ob, info.layer_index, info.onion_id, 0, layer.blend_mode, points_shown};
      std::copy_n(layer.to_world_space(*evaluated).base_ptr(), 16, draw.layer_to_world);
      const DrawKey key = {&ob, info.layer_index, info.onion_id};
      seen.add(key);
      const uint32_t hash = drawing_hash(*evaluated, info.drawing.strokes(), tint, layer_alpha, scene.toolsettings->gpencil_selectmode_edit);
      if (packed.lookup_default(key, ~hash) != hash) {
        packed.add_overwrite(key, hash);
        draw.changed = 1;
        pack_drawing(*evaluated, info.drawing, tint, layer_alpha, draw);
      }
      draws.append(draw);
    }
  }
  packed.remove_if([&](const auto &item) { return !seen.contains(item.key); });
  return draws.size();
}
EXPORT(main_grease_pencil_draws) const GreasePencilDraw *main_grease_pencil_draws() { return draws.data(); }
EXPORT(main_grease_pencil_curves) const int *main_grease_pencil_curves() { return curve_data.data(); }
EXPORT(main_grease_pencil_points) const float *main_grease_pencil_points() { return point_data.data(); }
EXPORT(main_grease_pencil_triangles) const uint32_t *main_grease_pencil_triangles() { return triangle_data.data(); }
