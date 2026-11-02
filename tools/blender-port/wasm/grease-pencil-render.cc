/* Grease Pencil's offscreen rendering (grease_pencil_image_render.cc), which the Fill tool's pixel solver renders the
 * strokes around the click with and reads back as an image (fill.cc render_strokes): Babylon is the GPU here. What
 * Blender draws between image_render_begin and image_render_end is recorded in view space, and image_render_end asks
 * the page to render it into a render target at the requested size with Blender's projection
 * (src/draw/grease-pencil-render.js), whose pixels become the Image Blender's fill algorithm reads. Drawn while no
 * offscreen is open (the fill tool's extension preview in the region), nothing is drawn: the region's drawing is the page's. */
#include "BKE_curves.hh"
#include "BKE_grease_pencil.hh"
#include "BKE_image.hh"
#include "BKE_material.hh"
#include "BLI_math_matrix.hh"
#include "DNA_material_types.h"
#include "DNA_object_types.h"
#include "DNA_view3d_types.h"
#include "ED_grease_pencil.hh"
#include "GPU_state.hh"
#include "IMB_imbuf.hh"
#include "IMB_imbuf_types.hh"

#define IMPORT(name) extern "C" __attribute__((import_module("env"), import_name(#name)))

/* Renders `lines` (first point, points, kind: LINE_WORLD a stroke whose widths are world diameters, LINE_PIXELS a line
 * whose widths are pixels, DOTS points of pixel size, DOTS_WORLD points of world diameter) of `points` (view-space position, width, RGBA) through the
 * projection `winmat` into `pixels` (width x height RGBA bytes, bottom row first, as glReadPixels gives them). */
IMPORT(grease_pencil_render)
void grease_pencil_render(int width, int height, const float *winmat, const int *lines, int line_count, const float *points, unsigned char *pixels);

namespace blender::ed::greasepencil::image_render {

enum { LINE_WORLD = 0, LINE_PIXELS = 1, DOTS = 2, DOTS_WORLD = 3 };
struct Recording {
  bool open = false;
  int2 size;
  float4x4 winmat = float4x4::identity();
  Vector<int> lines;
  Vector<float> points;
};
static Recording recording;
/* Any address stands for the buffer Blender keeps: the recording is the offscreen. */
static GPUOffScreen *const offscreen = reinterpret_cast<GPUOffScreen *>(&recording);

static void add_line(const int kind, const int count, const FunctionRef<void(int, float3 &, float &, float4 &)> point)
{
  if (!recording.open || count == 0) {
    return;
  }
  recording.lines.extend({int(recording.points.size() / 8), count, kind});
  for (const int i : IndexRange(count)) {
    float3 position;
    float width;
    float4 color;
    point(i, position, width, color);
    recording.points.extend({position.x, position.y, position.z, width, color.x, color.y, color.z, color.w});
  }
}

/* port-override: the offscreen is Babylon's render target (grease-pencil-render.js). */
GPUOffScreen *image_render_begin(const int2 &win_size)
{
  recording = {true, win_size};
  return offscreen;
}

/* port-override: the page renders the recording; its pixels become the Image, as GPU_offscreen_read_color gives them. */
Image *image_render_end(Main &bmain, GPUOffScreen * /*buffer*/)
{
  ImBuf *ibuf = IMB_allocImBuf(recording.size.x, recording.size.y, ImBufFlags::ByteData);
  grease_pencil_render(recording.size.x, recording.size.y, recording.winmat.base_ptr(), recording.lines.data(), recording.lines.size() / 3,
                       recording.points.data(), ibuf->byte_data_for_write());
  recording.open = false;
  Image *ima = BKE_image_add_from_imbuf(&bmain, ibuf, "Grease Pencil Fill");
  ima->id.tag |= ID_TAG_DOIT;
  BKE_image_release_ibuf(ima, ibuf, nullptr);
  return ima;
}

/* port-override: the projection is the recording's (cleared before image_render_end, so it stays); positions are
 * recorded in view space. */
void set_view_matrix(const RegionView3D & /*rv3d*/) {}
void clear_view_matrix() {}
void set_projection_matrix(const RegionView3D &rv3d) { recording.winmat = float4x4(rv3d.winmat); }
void clear_projection_matrix() {}

/* port-override: recorded. */
void draw_dot(const float4x4 &transform, const float3 &position, const float point_size, const ColorGeometry4f &color)
{
  add_line(DOTS, 1, [&](int, float3 &p, float &w, float4 &c) {
    p = math::transform_point(transform, position);
    w = point_size * float(M_SQRT2);
    c = float4(color);
  });
}

/* port-override: recorded. */
void draw_polyline(const float4x4 &transform, const IndexRange indices, Span<float3> positions, const VArray<ColorGeometry4f> &colors,
                   const bool cyclic, const float line_width)
{
  const int count = indices.size() + (cyclic && indices.size() > 2 ? 1 : 0);
  add_line(LINE_PIXELS, count, [&](int i, float3 &p, float &w, float4 &c) {
    const int point = indices[i % indices.size()];
    p = math::transform_point(transform, positions[point]);
    w = line_width;
    c = float4(colors[point]);
  });
}

/* port-override: recorded, a circle as a polyline of 32 segments (a filled one as one as wide as it). */
void draw_circles(const float4x4 &transform, const IndexRange indices, Span<float3> centers, const VArray<float> &radii,
                  const VArray<ColorGeometry4f> &colors, const float2 & /*viewport_size*/, const float line_width, const bool fill)
{
  constexpr int segments = 32;
  const float scale = math::average(math::to_scale(transform));
  for (const int point : indices) {
    const float3 center = math::transform_point(transform, centers[point]);
    const float radius = radii[point] * scale * (fill ? 0.5f : 1.0f);
    add_line(fill ? LINE_WORLD : LINE_PIXELS, segments + 1, [&](int i, float3 &p, float &w, float4 &c) {
      const float angle = 2.0f * float(M_PI) * i / segments;
      p = center + float3(radius * cosf(angle), radius * sinf(angle), 0.0f);
      w = fill ? 2.0f * radius : line_width;
      c = float4(colors[point]);
    });
  }
}

/* port-override: recorded. */
void draw_lines(const float4x4 &transform, IndexRange indices, Span<float3> start_positions, Span<float3> end_positions,
                const VArray<ColorGeometry4f> &colors, const float line_width)
{
  for (const int i : indices) {
    add_line(LINE_PIXELS, 2, [&](int end, float3 &p, float &w, float4 &c) {
      p = math::transform_point(transform, end ? end_positions[i] : start_positions[i]);
      w = line_width;
      c = float4(colors[i]);
    });
  }
}

/* port-override: recorded, each visible stroke as a line of its points' diameters (radius_scale applied), Dots and Squares
 * strokes as their points. */
void draw_grease_pencil_strokes(const RegionView3D &rv3d, const int2 & /*win_size*/, const Object &object, const bke::greasepencil::Drawing &drawing,
                                const float4x4 &transform, const IndexMask &strokes_mask, const VArray<ColorGeometry4f> &colors,
                                const bool /*use_xray*/, const float radius_scale)
{
  const float4x4 to_view = float4x4(rv3d.viewmat) * transform;
  const float scale = math::average(math::to_scale(to_view));
  const bke::CurvesGeometry &curves = drawing.strokes();
  curves.ensure_can_interpolate_to_evaluated();
  const OffsetIndices points_by_curve = curves.evaluated_points_by_curve();
  const Span<float3> positions = curves.evaluated_positions();
  Array<float> radii(positions.size());
  curves.interpolate_to_evaluated(VArraySpan(drawing.radii()), radii.as_mutable_span());
  Array<ColorGeometry4f> point_colors(positions.size());
  curves.interpolate_to_evaluated(VArraySpan(colors), point_colors.as_mutable_span());
  const VArray<bool> cyclic = curves.cyclic();
  const VArray<int> materials = *curves.attributes().lookup_or_default<int>("material_index", bke::AttrDomain::Curve, 0);
  strokes_mask.foreach_index([&](const int curve) {
    const Material *ma = BKE_object_material_get(const_cast<Object *>(&object), materials[curve] + 1);
    if (ma == nullptr || (ma->gp_style->flag & GP_MATERIAL_HIDE)) {
      return;
    }
    const IndexRange points = points_by_curve[curve];
    const bool line = ma->gp_style->mode == GP_MATERIAL_MODE_LINE;
    const int count = points.size() + (line && cyclic[curve] && points.size() > 2 ? 1 : 0);
    add_line(line ? LINE_WORLD : DOTS_WORLD, count, [&](int i, float3 &p, float &w, float4 &c) {
      const int point = points[i % points.size()];
      p = math::transform_point(to_view, positions[point]);
      w = std::max(2.0f * radii[point] * radius_scale * scale, 0.0f);
      c = float4(point_colors[point]);
    });
  });
}

}  // namespace blender::ed::greasepencil::image_render

namespace blender {
/* The offscreen's depth writes are the page's render target's (grease-pencil-render.js). */
void GPU_depth_mask(bool /*depth*/) {}
}  // namespace blender
