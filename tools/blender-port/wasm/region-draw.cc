/* A region drawn without a GPU. What Blender's drawing code draws (immediate mode, round boxes, text, SVG icons) is
 * recorded in region pixels (y up), and the buttons its blocks define are listed, both written as JSON that JS draws and
 * hit-tests (src/editors/interface/region-draw.js). Interface code above these calls is Blender's own:
 * resources.cc gives the theme, interface_style.cc the fonts' styles, interface_icons.cc the icons' sizes and colors.
 * Text is measured by JS, which draws it with the browser's fonts. */
#include <cstring>
#include <memory>
#include <string>
#include <vector>

#include "BKE_context.hh"
#include "BLF_api.hh"
#include "BLI_math_color.h"
#include "BLI_math_geom.h"
#include "BLI_math_matrix.h"
#include "BLI_math_vector.h"
#include "BLI_rect.h"
#include "BLI_string.h"
#include "BLI_string_utf8.h"
#include "DNA_screen_types.h"
#include "DNA_userdef_types.h"
#include "GPU_framebuffer.hh"
#include "GPU_immediate.hh"
#include "GPU_matrix.hh"
#include "GPU_state.hh"
#include "GPU_vertex_format.hh"
#include "MEM_guardedalloc.h"
#include "RNA_access.hh"
#include "UI_interface_c.hh"
#include "UI_interface_icons.hh"
#include "UI_interface_layout.hh"
#include "UI_resources.hh"
#include "WM_api.hh"

#include "BKE_wm_runtime.hh"
#include "BLI_set.hh"
#include "WM_types.hh"
#include "interface_intern.hh"

using namespace blender;

#define EXPORT(name) extern "C" __attribute__((export_name(#name)))
#define IMPORT(name) extern "C" __attribute__((import_module("env"), import_name(#name)))

/* Text metrics of the browser's font at a size in pixels. */
IMPORT(region_text_width) float region_text_width(const char *str, int len, float size);
IMPORT(region_font_ascender) float region_font_ascender(float size);
IMPORT(region_mono_width) float region_mono_width(float size);
IMPORT(region_font_descender) float region_font_descender(float size);

/* The JSON of what one region draw recorded. */
struct Recording {
  std::string draw, buttons;
  /* The theme colors of multicolor icons' groups (blender_* ids), as "id":"rrggbbaa". */
  std::string icon_colors;
  int winx = 0, winy = 0;
  /* The projection (wmOrtho2): which view rectangle maps to the region's pixels. */
  rctf ortho = {};
  rcti scissor = {};
  bool scissored = false;
  float line_width = 1.0f;
};
static Recording rec;

static void number(std::string &s, float v)
{
  char buf[32];
  SNPRINTF(buf, "%.6g", v);
  s += buf;
}

static void color_json(std::string &s, const float c[4])
{
  s += '[';
  for (int i = 0; i < 4; i++) {
    if (i) {
      s += ',';
    }
    number(s, c[i]);
  }
  s += ']';
}

static void string_json(std::string &s, StringRef text)
{
  s += '"';
  for (const char c : text) {
    if (c == '"' || c == '\\') {
      s += '\\';
      s += c;
    }
    else if (uchar(c) < 0x20) {
      char buf[8];
      SNPRINTF(buf, "\\u%04x", c);
      s += buf;
    }
    else {
      s += c;
    }
  }
  s += '"';
}

/* A point of the current projection in region pixels. */
static float2 to_region(float x, float y)
{
  const rctf &o = rec.ortho;
  return {(x - o.xmin) / (o.xmax - o.xmin) * rec.winx, (y - o.ymin) / (o.ymax - o.ymin) * rec.winy};
}

/* Starts a draw command: {"op":kind, "clip":[...]?, ...}. */
static std::string &command(const char *op)
{
  std::string &s = rec.draw;
  if (!s.empty()) {
    s += ',';
  }
  s += "{\"op\":\"";
  s += op;
  s += '"';
  if (rec.scissored) {
    s += ",\"clip\":[";
    number(s, rec.scissor.xmin);
    s += ',';
    number(s, rec.scissor.ymin);
    s += ',';
    number(s, rec.scissor.xmax);
    s += ',';
    number(s, rec.scissor.ymax);
    s += ']';
  }
  return s;
}

static void points_json(std::string &s, const char *key, Span<float2> points)
{
  s += ",\"";
  s += key;
  s += "\":[";
  for (const int i : points.index_range()) {
    const float2 p = to_region(points[i].x, points[i].y);
    if (i) {
      s += ',';
    }
    number(s, p.x);
    s += ',';
    number(s, p.y);
  }
  s += ']';
}

/* The icon names of UI_icons.hh, by icon id. */
static const char *icon_names[] = {
#define DEF_ICON(name) #name,
#define DEF_ICON_VECTOR(name) #name,
#define DEF_ICON_BLANK(name) #name,
#include "UI_icons.hh"
#undef DEF_ICON
#undef DEF_ICON_VECTOR
#undef DEF_ICON_BLANK
};

EXPORT(ui_icon_name) const char *ui_icon_name(int icon)
{
  return icon >= 0 && icon < int(ARRAY_SIZE(icon_names)) ? icon_names[icon] : "NONE";
}

namespace blender {

/* GPU state and matrices: the projection is the one wmOrtho2 sets, the model-view matrix stays the identity. */

void wmOrtho2(float x1, float x2, float y1, float y2) { rec.ortho = {x1, x2, y1, y2}; }
void wmOrtho2_region_pixelspace(const ARegion *region) { wmOrtho2(0.0f, region->winx, 0.0f, region->winy); }
void GPU_matrix_identity_set() {}
void GPU_matrix_push() {}
void GPU_matrix_pop() {}
/* The projection is the ortho rectangle (wmOrtho2): pushed and popped as a stack. */
static Vector<rctf> &projections()
{
  static Vector<rctf> stack;
  return stack;
}
void GPU_matrix_push_projection() { projections().append(rec.ortho); }
void GPU_matrix_pop_projection() { rec.ortho = projections().pop_last(); }
/* The projection (the ortho rectangle) as a matrix, which blocks take their aspect from; the model-view's identity. */
const float (*(GPU_matrix_projection_get)(float m[4][4]))[4]
{
  orthographic_m4(m, rec.ortho.xmin, rec.ortho.xmax, rec.ortho.ymin, rec.ortho.ymax, -100.0f, 100.0f);
  return m;
}
const float (*(GPU_matrix_model_view_get)(float m[4][4]))[4]
{
  unit_m4(m);
  return m;
}
void GPU_blend(GPUBlend /*blend*/) {}
GPUBlend GPU_blend_get() { return GPU_BLEND_ALPHA; }
void GPU_line_smooth(bool /*enable*/) {}
void GPU_polygon_smooth(bool /*enable*/) {}
void GPU_line_width(float width) { rec.line_width = width; }
void GPU_scissor(int x, int y, int width, int height)
{
  rec.scissor = {x, x + width, y, y + height};
  rec.scissored = !(x == 0 && y == 0 && width >= rec.winx && height >= rec.winy);
}
void GPU_scissor_get(int coords[4])
{
  if (rec.scissored) {
    coords[0] = rec.scissor.xmin;
    coords[1] = rec.scissor.ymin;
    coords[2] = BLI_rcti_size_x(&rec.scissor);
    coords[3] = BLI_rcti_size_y(&rec.scissor);
  }
  else {
    coords[0] = coords[1] = 0;
    coords[2] = rec.winx;
    coords[3] = rec.winy;
  }
}
void GPU_viewport_size_get_f(float coords[4])
{
  coords[0] = coords[1] = 0.0f;
  coords[2] = rec.winx;
  coords[3] = rec.winy;
}
void GPU_clear_color(float red, float green, float blue, float alpha)
{
  const float color[4] = {red, green, blue, alpha};
  color_json(command("clear") += ",\"color\":", color);
  rec.draw += '}';
}

/* Immediate mode: a primitive's vertices (2D positions) with one uniform color. */

static struct {
  GPUVertFormat format;
  GPUBuiltinShader shader;
  GPUPrimType prim;
  Vector<float2> verts;
  float color[4] = {1.0f, 1.0f, 1.0f, 1.0f};
  float dash_factor = 1.0f, dash_width = 8.0f;
} imm;

GPUVertFormat *immVertexFormat()
{
  imm.format = {};
  return &imm.format;
}
uint GPU_vertformat_attr_add(GPUVertFormat * /*format*/, StringRef /*name*/, gpu::VertAttrType /*type*/) { return 0; }
void immBindBuiltinProgram(GPUBuiltinShader shader_id)
{
  imm.shader = shader_id;
  imm.dash_factor = 1.0f;
}
void immUnbindProgram() {}
void immUniform1i(const char * /*name*/, int /*x*/) {}
void immUniform1f(const char *name, float x)
{
  if (STREQ(name, "udash_factor")) {
    imm.dash_factor = x;
  }
  else if (STREQ(name, "dash_width")) {
    imm.dash_width = x;
  }
}
void immUniform2f(const char * /*name*/, float /*x*/, float /*y*/) {}
void immUniform2fv(const char * /*name*/, const float /*data*/[2]) {}
void immUniformColor4f(float r, float g, float b, float a)
{
  imm.color[0] = r;
  imm.color[1] = g;
  imm.color[2] = b;
  imm.color[3] = a;
}
void immUniformColor4fv(const float rgba[4]) { immUniformColor4f(rgba[0], rgba[1], rgba[2], rgba[3]); }
void immUniformColor3f(float r, float g, float b) { immUniformColor4f(r, g, b, 1.0f); }
void immUniformColor3fv(const float rgb[3]) { immUniformColor4f(rgb[0], rgb[1], rgb[2], 1.0f); }
void immUniformColor3fvAlpha(const float rgb[3], float a) { immUniformColor4f(rgb[0], rgb[1], rgb[2], a); }

/* As gpu_immediate.cc defines them. */
void immUniformColor3ub(uchar r, uchar g, uchar b)
{
  const float scale = 1.0f / 255.0f;
  immUniformColor4f(scale * r, scale * g, scale * b, 1.0f);
}
void immUniformColor4ub(uchar r, uchar g, uchar b, uchar a)
{
  const float scale = 1.0f / 255.0f;
  immUniformColor4f(scale * r, scale * g, scale * b, scale * a);
}
void immUniformColor3ubv(const uchar rgb[3]) { immUniformColor3ub(rgb[0], rgb[1], rgb[2]); }
void immUniformColor3ubvAlpha(const uchar rgb[3], uchar alpha) { immUniformColor4ub(rgb[0], rgb[1], rgb[2], alpha); }
void immUniformColor4ubv(const uchar rgba[4]) { immUniformColor4ub(rgba[0], rgba[1], rgba[2], rgba[3]); }
void immUniformThemeColor(int color_id)
{
  float color[4];
  ui::theme::get_color_4fv(color_id, color);
  immUniformColor4fv(color);
}
void immUniformThemeColorAlpha(int color_id, float a)
{
  float color[4];
  ui::theme::get_color_3fv(color_id, color);
  color[3] = a;
  immUniformColor4fv(color);
}
void immUniformThemeColor3(int color_id)
{
  float color[3];
  ui::theme::get_color_3fv(color_id, color);
  immUniformColor3fv(color);
}
void immUniformThemeColorShade(int color_id, int offset)
{
  float color[4];
  ui::theme::get_color_shade_4fv(color_id, offset, color);
  immUniformColor4fv(color);
}
void immUniformThemeColorShadeAlpha(int color_id, int color_offset, int alpha_offset)
{
  float color[4];
  ui::theme::get_color_shade_alpha_4fv(color_id, color_offset, alpha_offset, color);
  immUniformColor4fv(color);
}
void immUniformThemeColorBlendShade(int color_id1, int color_id2, float fac, int offset)
{
  float color[4];
  ui::theme::get_color_blend_shade_4fv(color_id1, color_id2, fac, offset, color);
  immUniformColor4fv(color);
}
void immUniformThemeColorBlend(int color_id1, int color_id2, float fac)
{
  uint8_t color[3];
  ui::theme::get_color_blend_3ubv(color_id1, color_id2, fac, color);
  immUniformColor3ubv(color);
}
void immThemeColorShadeAlpha(int colorid, int coloffset, int alphaoffset)
{
  uchar col[4];
  ui::theme::get_color_shade_alpha_4ubv(colorid, coloffset, alphaoffset, col);
  immUniformColor4ub(col[0], col[1], col[2], col[3]);
}

void immBegin(GPUPrimType prim, uint vertex_len)
{
  imm.prim = prim;
  imm.verts.clear();
  imm.verts.reserve(vertex_len);
}
void immBeginAtMost(GPUPrimType prim, uint vertex_len) { immBegin(prim, vertex_len); }
void immVertex2f(uint /*attr_id*/, float x, float y) { imm.verts.append({x, y}); }
void immVertex2fv(uint attr_id, const float data[2]) { immVertex2f(attr_id, data[0], data[1]); }
void immVertex3f(uint attr_id, float x, float y, float /*z*/) { immVertex2f(attr_id, x, y); }
void immVertex3fv(uint attr_id, const float data[3]) { immVertex2f(attr_id, data[0], data[1]); }

/* Triangles of a strip or fan, as the GPU assembles them. */
static Vector<float2> triangles(GPUPrimType prim, Span<float2> v)
{
  Vector<float2> tris;
  for (int i = 2; i < v.size(); i++) {
    if (prim == GPU_PRIM_TRI_FAN) {
      tris.extend({v[0], v[i - 1], v[i]});
    }
    else {
      tris.extend({v[i - 2], v[i - 1], v[i]});
    }
  }
  return tris;
}

/* Segments of a line strip or loop, as pairs. */
static Vector<float2> segments(GPUPrimType prim, Span<float2> v)
{
  Vector<float2> lines;
  for (int i = 1; i < v.size(); i++) {
    lines.extend({v[i - 1], v[i]});
  }
  if (prim == GPU_PRIM_LINE_LOOP && v.size() > 2) {
    lines.extend({v.last(), v[0]});
  }
  return lines;
}

void immEnd()
{
  Span<float2> v = imm.verts;
  if (ELEM(imm.prim, GPU_PRIM_TRIS, GPU_PRIM_TRI_FAN, GPU_PRIM_TRI_STRIP)) {
    std::string &s = command("tris");
    points_json(s, "points", imm.prim == GPU_PRIM_TRIS ? Vector<float2>(v) : triangles(imm.prim, v));
    color_json(s += ",\"color\":", imm.color);
    s += '}';
  }
  else if (ELEM(imm.prim, GPU_PRIM_LINES, GPU_PRIM_LINE_STRIP, GPU_PRIM_LINE_LOOP)) {
    std::string &s = command("lines");
    points_json(s, "points", imm.prim == GPU_PRIM_LINES ? Vector<float2>(v) : segments(imm.prim, v));
    color_json(s += ",\"color\":", imm.color);
    number(s += ",\"width\":", rec.line_width);
    if (imm.shader == GPU_SHADER_3D_LINE_DASHED_UNIFORM_COLOR && imm.dash_factor < 1.0f) {
      number(s += ",\"dash\":[", imm.dash_width * imm.dash_factor);
      number(s += ",", imm.dash_width * (1.0f - imm.dash_factor));
      s += ']';
    }
    s += '}';
  }
  imm.verts.clear();
}

/* As gpu_immediate_util.cc defines it. */
void immRectf(uint pos, float x1, float y1, float x2, float y2)
{
  immBegin(GPU_PRIM_TRI_FAN, 4);
  immVertex2f(pos, x1, y1);
  immVertex2f(pos, x2, y1);
  immVertex2f(pos, x2, y2);
  immVertex2f(pos, x1, y2);
  immEnd();
}

namespace ui {

/* Round boxes: what interface_draw.cc draws with the widget shader, a box filled inside its outline. */

static int roundboxtype = CNR_ALL;
void draw_roundbox_corner_set(int type) { roundboxtype = type; }

void draw_roundbox_4fv_ex(const rctf *rect,
                          const float inner1[4],
                          const float inner2[4],
                          float /*shade_dir*/,
                          const float outline[4],
                          float outline_width,
                          float rad)
{
  std::string &s = command("roundbox");
  points_json(s, "rect", {{rect->xmin, rect->ymin}, {rect->xmax, rect->ymax}});
  number(s += ",\"radius\":", rad);
  number(s += ",\"corners\":", roundboxtype);
  const float none[4] = {0.0f, 0.0f, 0.0f, 0.0f};
  color_json(s += ",\"inner\":", inner1 ? inner1 : none);
  if (inner2) {
    color_json(s += ",\"inner2\":", inner2);
  }
  color_json(s += ",\"outline\":", outline ? outline : inner1 ? inner1 : none);
  number(s += ",\"outlineWidth\":", outline_width);
  s += '}';
}

/* As interface_draw.cc defines them. */
void draw_roundbox_3ub_alpha(const rctf *rect, bool filled, float rad, const uchar col[3], uchar alpha)
{
  const float colv[4] = {col[0] / 255.0f, col[1] / 255.0f, col[2] / 255.0f, alpha / 255.0f};
  draw_roundbox_4fv_ex(rect, (filled) ? colv : nullptr, nullptr, 1.0f, colv, U.pixelsize, rad);
}
void draw_roundbox_3fv_alpha(const rctf *rect, bool filled, float rad, const float col[3], float alpha)
{
  const float colv[4] = {col[0], col[1], col[2], alpha};
  draw_roundbox_4fv_ex(rect, (filled) ? colv : nullptr, nullptr, 1.0f, colv, U.pixelsize, rad);
}
void draw_roundbox_aa(const rctf *rect, bool filled, float rad, const float color[4])
{
  float colv[4] = {color[0], color[1], color[2], color[3]};
  if (filled) {
    colv[3] *= 0.65f;
  }
  draw_roundbox_4fv_ex(rect, (filled) ? colv : nullptr, nullptr, 1.0f, colv, U.pixelsize, rad);
}
void draw_roundbox_4fv(const rctf *rect, bool filled, float rad, const float col[4])
{
  draw_roundbox_4fv_ex(rect, (filled) ? col : nullptr, nullptr, 1.0f, col, U.pixelsize, rad);
}

/* A scroller as interface_widgets.cc draws it, its back in the theme's inner color and its slider in the item color,
 * both as flat round boxes (the widget shader's shading is left out). */
void draw_widget_scroll(uiWidgetColors *wcol, const rcti *rect, const rcti *slider, int /*state*/)
{
  const bool horizontal = BLI_rcti_size_x(rect) > BLI_rcti_size_y(rect);
  const float rad = wcol->roundness * (horizontal ? BLI_rcti_size_y(rect) : BLI_rcti_size_x(rect));
  const auto box = [&](const rcti *r, const uchar col[4]) {
    rctf rf;
    BLI_rctf_rcti_copy(&rf, r);
    float colv[4], outv[4];
    rgba_uchar_to_float(colv, col);
    rgba_uchar_to_float(outv, wcol->outline);
    draw_roundbox_corner_set(CNR_ALL);
    draw_roundbox_4fv_ex(&rf, colv, nullptr, 1.0f, outv, U.pixelsize, rad);
  };
  box(rect, wcol->inner);
  if (BLI_rcti_size_x(slider) >= 2 && BLI_rcti_size_y(slider) >= 2) {
    box(slider, wcol->item);
  }
}

/* Nothing is batched, so there is nothing to flush before icons draw. */
void widgetbase_draw_cache_flush() {}

}  // namespace ui

/* Fonts: each font id's size, position, color and clipping; JS draws and measures the text. */

static struct Font {
  float size = 11.0f;
  float2 pos = {};
  float color[4] = {1.0f, 1.0f, 1.0f, 1.0f};
  rcti clip = {};
  FontFlags flag = BLF_NONE;
} fonts[4];

static Font &font(int fontid) { return fonts[clamp_i(fontid, 0, ARRAY_SIZE(fonts) - 1)]; }

int BLF_load_default(bool /*unique*/) { return 0; }
int BLF_load_mono_default(bool /*unique*/) { return 1; }
int BLF_load(const char * /*filepath*/) { return 0; }
int BLF_load_unique(const char * /*filepath*/) { return 1; }
void BLF_unload_all() {}
void BLF_load_font_stack() {}
void BLF_default_set(int /*fontid*/) {}
void BLF_default_size(float size) { fonts[0].size = size; }
int BLF_default() { return 0; }
int BLF_set_default() { return 0; }
void BLF_cache_flush_set_fn(void (* /*cache_flush_fn*/)()) {}
void BLF_size(int fontid, float size) { font(fontid).size = size; }
void BLF_character_weight(int /*fontid*/, int /*weight*/) {}
void BLF_position(int fontid, float x, float y, float /*z*/) { font(fontid).pos = {x, y}; }
void BLF_color4fv(int fontid, const float rgba[4]) { copy_v4_v4(font(fontid).color, rgba); }
void BLF_color4ubv(int fontid, const uchar rgba[4]) { rgba_uchar_to_float(font(fontid).color, rgba); }
void BLF_color3ubv(int fontid, const uchar rgb[3])
{
  rgb_uchar_to_float(font(fontid).color, rgb);
  font(fontid).color[3] = 1.0f;
}
void BLF_enable(int fontid, FontFlags flag) { font(fontid).flag |= flag; }
void BLF_disable(int fontid, FontFlags flag) { font(fontid).flag &= ~flag; }
void BLF_clipping(int fontid, int xmin, int ymin, int xmax, int ymax) { font(fontid).clip = {xmin, xmax, ymin, ymax}; }
/* port-override: text is drawn without shadows; the browser's text rendering is not Blender's. */
void BLF_shadow(int /*fontid*/, FontShadowType /*type*/, const float /*rgba*/[4]) {}
void BLF_shadow_offset(int /*fontid*/, int /*x*/, int /*y*/) {}
void BLF_rotation(int /*fontid*/, float /*angle*/) {}

static size_t text_length(const char *str, size_t str_len) { return strnlen(str, str_len); }

float BLF_width(int fontid, const char *str, size_t str_len, ResultBLF * /*r_info*/)
{
  return region_text_width(str, int(text_length(str, str_len)), font(fontid).size);
}
int BLF_height_max(int fontid)
{
  return int(ceilf(region_font_ascender(font(fontid).size) - region_font_descender(font(fontid).size)));
}
int BLF_ascender(int fontid) { return int(region_font_ascender(font(fontid).size)); }
int BLF_descender(int fontid) { return int(region_font_descender(font(fontid).size)); }
/* The font's ascender stands in for the text's ink height, which JS does not measure. */
float BLF_height(int fontid, const char * /*str*/, size_t /*str_len*/, ResultBLF * /*r_info*/)
{
  return region_font_ascender(font(fontid).size);
}
void BLF_width_and_height(int fontid, const char *str, size_t str_len, float *r_width, float *r_height)
{
  *r_width = BLF_width(fontid, str, str_len);
  *r_height = BLF_height_max(fontid);
}

void BLF_draw(int fontid, const char *str, size_t str_len, ResultBLF * /*r_info*/)
{
  const Font &f = font(fontid);
  std::string &s = command("text");
  string_json(s += ",\"text\":", StringRef(str, text_length(str, str_len)));
  points_json(s, "at", {f.pos});
  number(s += ",\"size\":", f.size);
  color_json(s += ",\"color\":", f.color);
  if (f.flag & BLF_CLIPPING) {
    points_json(s, "textClip", {{float(f.clip.xmin), float(f.clip.ymin)}, {float(f.clip.xmax), float(f.clip.ymax)}});
  }
  s += '}';
}
/* Monospace text (the Text Editor's, the Console's): one cell of `cwidth` per column, a tab to the next multiple of
 * `tab_columns`, as blf_font_draw_mono lays it out; returns the columns drawn. */
int BLF_draw_mono(int fontid, const char *str, size_t str_len, int cwidth, int tab_columns)
{
  const Font &f = font(fontid);
  std::string cells;
  int columns = 0;
  for (const char *c = str, *end = str + text_length(str, str_len); c < end; c = BLI_str_find_next_char_utf8(c, end)) {
    const int width = *c == '\t' ? tab_columns - columns % tab_columns : 1;
    cells.append(*c == '\t' ? std::string(width, ' ') : std::string(c, BLI_str_find_next_char_utf8(c, end) - c));
    columns += width;
  }
  std::string &s = command("text");
  string_json(s += ",\"text\":", cells);
  points_json(s, "at", {f.pos});
  number(s += ",\"size\":", f.size);
  number(s += ",\"mono\":", cwidth);
  color_json(s += ",\"color\":", f.color);
  s += '}';
  return columns;
}
float BLF_fixed_width(int fontid) { return region_mono_width(font(fontid).size); }

void BLF_draw_default(float x, float y, float z, const char *str, size_t str_len)
{
  BLF_position(BLF_default(), x, y, z);
  BLF_draw(BLF_default(), str, str_len);
}
void BLF_batch_draw_begin() {}
void BLF_batch_draw_end() {}

/* The colors an icon's edit (icon_source_edit_cb) gives its themed groups: it edits a probe with one group per id of
 * svg_replace_color_attributes. */
static void icon_colors_record(FunctionRef<void(std::string &)> edit_source_cb)
{
  static const char *ids[] = {"blender_white", "blender_black", "blender_logo_orange", "blender_logo_blue", "blender_selected",
                              "blender_mesh_selected", "blender_back", "blender_text", "blender_text_hi", "blender_red_alert",
                              "blender_error", "blender_warning", "blender_info", "blender_scene", "blender_collection",
                              "blender_collection_color_01", "blender_collection_color_02", "blender_collection_color_03",
                              "blender_collection_color_04", "blender_collection_color_05", "blender_collection_color_06",
                              "blender_collection_color_07", "blender_collection_color_08", "blender_object", "blender_object_data",
                              "blender_modifier", "blender_shading", "blender_folder", "blender_fund", "blender_autokey",
                              "blender_tool_add", "blender_tool_remove", "blender_tool_select", "blender_tool_transform",
                              "blender_tool_white", "blender_tool_red", "blender_bevel", "blender_crease", "blender_seam",
                              "blender_sharp", "blender_ipo_linear", "blender_ipo_constant", "blender_ipo_other"};
  std::string probe;
  for (const char *id : ids) {
    probe += std::string("<g id=\"") + id + "\" fill=\"?\"></g>";
  }
  edit_source_cb(probe);
  for (const char *id : ids) {
    const size_t at = probe.find(std::string("id=\"") + id + "\" fill=\"#");
    if (at == std::string::npos) {
      continue;
    }
    const size_t start = probe.find('#', at) + 1;
    if (!rec.icon_colors.empty()) {
      rec.icon_colors += ',';
    }
    rec.icon_colors += std::string("\"") + id + "\":\"" + probe.substr(start, probe.find('"', start) - start) + '"';
  }
}

/* An SVG icon at a size in pixels, monochrome in a color (or its own colors), with an outline of some opacity. */
void BLF_draw_svg_icon(uint icon_id,
                       float x,
                       float y,
                       float size,
                       const float color[4],
                       float outline_alpha,
                       bool multicolor,
                       FunctionRef<void(std::string &)> edit_source_cb)
{
  if (multicolor && edit_source_cb && rec.icon_colors.empty()) {
    icon_colors_record(edit_source_cb);
  }
  std::string &s = command("icon");
  string_json(s += ",\"icon\":", ui_icon_name(int(icon_id)));
  points_json(s, "at", {{x, y}});
  number(s += ",\"size\":", size);
  const float white[4] = {1.0f, 1.0f, 1.0f, 1.0f};
  color_json(s += ",\"color\":", color ? color : white);
  number(s += ",\"outline\":", outline_alpha);
  if (multicolor) {
    s += ",\"multicolor\":true";
  }
  s += '}';
}

}  // namespace blender

/* Blocks and buttons are Blender's (interface.cc), defined by a region's code. Drawing a block draws the icon buttons
 * a region's code defines (button_draw) and records each button with its rectangle, which JS hit-tests and presses
 * (region_button_press, region_button_text); a block laid out by Blender's layout (the channel search row) is
 * recorded as its layout tree (ui-tree.cc), drawn by the shared layout renderer over the region. JS draws text
 * buttons being edited with its own field. */

namespace blender::ui {

std::string block_layout_json(const Block *block, rctf *r_rect);

/* The buttons the last draw drew, by their index in it, and the region they are in, whose blocks go at the next draw. */
static Vector<Button *> &buttons()
{
  static Vector<Button *> list;
  return list;
}
static struct {
  const bContext *C = nullptr;
  ARegion *region = nullptr;
} drawn;

/* port-override: JS applies a button within the event that pressed it, so none stays active, nor shows a tooltip. */
Button *context_active_but_get(const bContext * /*C*/) { return nullptr; }
void button_tooltip_timer_remove(bContext * /*C*/, Button * /*but*/) {}

/* port-override: JS edits a text button in its own field until it applies or cancels the edit. */
static Set<const Button *> editing;
static bool text_edit_cancelled = false;
bool button_active_only(const bContext * /*C*/, ARegion * /*region*/, Block * /*block*/, Button *but)
{
  const bool active = !std::exchange(text_edit_cancelled, false);
  if (active) {
    editing.add(but);
  }
  return active;
}

/* port-override: interface_widgets.cc's draw_button for the icon buttons a region's code defines (WidgetStyle::Icon,
 * IconLabel and Label: icon toggles without embossing, icon labels), with its widget_state, widget_state_label,
 * widget_color_disabled and widget_draw_icon; text buttons being edited are JS's own field. */
static void button_draw(const Button *but)
{
  const bool is_label = ELEM(but->type, ButtonType::Label, ButtonType::Text);
  if (!(but->flag & UI_HAS_ICON) || !(is_label || ELEM(but->emboss, EmbossType::None, EmbossType::NoneOrStatus))) {
    return;
  }
  uiWidgetColors wcol = theme::theme_get()->tui.wcol_regular;
  if (but->flag & (BUT_DISABLED | BUT_INACTIVE)) {
    wcol.text[3] *= 0.5f;
    wcol.text_sel[3] *= 0.5f;
  }
  if (but->flag & UI_SELECT) {
    copy_v3_v3_uchar(wcol.text, wcol.text_sel);
  }
  if (is_label) {
    theme::get_color_3ubv((but->flag & UI_SELECT) ? TH_TEXT_HI : TH_TEXT, wcol.text);
  }
  float alpha = wcol.text[3] / 255.0f;
  if (but->type == ButtonType::Label) {
    alpha *= static_cast<const ButtonLabel *>(but)->alpha_factor;
  }
  const float aspect = UI_INV_SCALE_FAC;
  const float height = ICON_DEFAULT_HEIGHT / aspect;
  const float xs = roundf((but->rect.xmin + but->rect.xmax - height) / 2.0f);
  const float ys = roundf((but->rect.ymin + but->rect.ymax - height) / 2.0f);
  uchar color[4] = {wcol.text[0], wcol.text[1], wcol.text[2], wcol.text[3]};
  const int icon = button_icon(but);
  const bool has_theme = icon_get_theme_color(icon, color);
  const bool outline = theme::theme_get()->tui.icon_border_intensity > 0.0f && has_theme;
  if (!(but->flag & (UI_HOVER | UI_SELECT)) && has_theme) {
    alpha *= 0.8f;
  }
  icon_draw_ex(xs, ys, icon, aspect, alpha, 0.0f, color, outline, nullptr);
}

/* port-override: a block's draw is recorded: its icon buttons, every button with its rectangle, and its layout's tree. */
void block_draw(const bContext *C, Block *block)
{
  drawn = {C, CTX_wm_region(C)};
  rctf layout_rect;
  const std::string layout = block_layout_json(block, &layout_rect);
  if (!layout.empty()) {
    std::string &s = command("layout");
    points_json(s, "rect", {{layout_rect.xmin, layout_rect.ymin}, {layout_rect.xmax, layout_rect.ymax}});
    s += ",\"layout\":" + layout + '}';
  }
  for (Button &but : block->buttons()) {
    button_draw(&but);
    std::string &s = rec.buttons;
    if (!s.empty()) {
      s += ',';
    }
    char head[96];
    SNPRINTF(head, "{\"index\":%d,\"type\":%d,\"flag\":%d,\"retval\":%d", int(buttons().size()), int(but.type), but.flag, but.retval);
    s += head;
    points_json(s, "rect", {{but.rect.xmin, but.rect.ymin}, {but.rect.xmax, but.rect.ymax}});
    if (!but.tip.is_empty()) {
      string_json(s += ",\"tip\":", but.tip);
    }
    if (but.type == ButtonType::Text) {
      string_json(s += ",\"text\":", but.poin ? StringRef(but.poin) : StringRef(but.str));
      number(s += ",\"maxlength\":", but.hardmax);
    }
    if (editing.contains(&but)) {
      s += ",\"active\":true";
    }
    if (but.optype) {
      string_json(s += ",\"operator\":", but.optype->idname);
    }
    if (button_is_toggle(&but)) {
      s += (but.flag & UI_SELECT) ? ",\"selected\":true" : ",\"selected\":false";
    }
    s += '}';
    buttons().append(&but);
  }
}

}  // namespace blender::ui

/* Starts recording a region's draw, `winx` by `winy` pixels; the last draw's blocks go. */
EXPORT(region_draw_begin) void region_draw_begin(int winx, int winy)
{
  if (ui::drawn.region) {
    ui::blocklist_free(ui::drawn.C, ui::drawn.region);
    ui::drawn = {};
  }
  ui::editing.clear();
  ui::buttons().clear();
  rec = {};
  rec.winx = winx;
  rec.winy = winy;
  rec.ortho = {0.0f, float(winx), 0.0f, float(winy)};
}

/* The recording since region_draw_begin, as JSON: what was drawn, the buttons, and the colors of multicolor icons. */
EXPORT(region_draw_end) const char *region_draw_end()
{
  static std::string json;
  json = "{\"draw\":[" + rec.draw + "],\"buttons\":[" + rec.buttons + "],\"iconColors\":{" + rec.icon_colors + "}}";
  return json.c_str();
}

/* The window's event state while a button applies: what its function reads of the keys held (Ctrl isolates, Shift sets
 * children). */
static void event_modifier_set(bContext *C, int modifier)
{
  wmWindow *win = CTX_wm_window(C);
  if (win && win->runtime && win->runtime->eventstate) {
    win->runtime->eventstate->modifier = wmEventModifierFlag(modifier);
  }
}

extern "C" int ui_button_press(bContext *C, ui::Button *but, int value);
extern "C" void ui_button_text_set(bContext *C, ui::Button *but, const char *text);

/* A drawn button pressed, as Blender applies it (ui-tree.cc's ui_button_press), with keys held. */
EXPORT(region_button_press) int region_button_press(bContext *C, int index, int value, int modifier)
{
  event_modifier_set(C, modifier);
  const int state = ui_button_press(C, ui::buttons()[index], value);
  event_modifier_set(C, 0);
  return state;
}

/* Applies a text button's edit (its new text), or cancels it (null), as its text editing ends. */
EXPORT(region_button_text) void region_button_text(bContext *C, int index, const char *text)
{
  if (!text) {
    ui::text_edit_cancelled = true;
    return;
  }
  ui_button_text_set(C, ui::buttons()[index], text);
}
