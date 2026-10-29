/* A region drawn without a GPU. What Blender's drawing code draws (immediate mode, round boxes, text, SVG icons) is
 * recorded in region pixels (y up), and the buttons its blocks define are kept, both written as JSON that JS draws on a
 * canvas and hit-tests (src/editors/interface/region-draw.js). Interface code above these calls is Blender's own:
 * resources.cc gives the theme, interface_style.cc the fonts' styles, interface_icons.cc the icons' sizes and colors.
 * Text is measured by JS, which draws it with the browser's fonts. */
#include <cstring>
#include <memory>
#include <string>
#include <vector>

#include "BKE_context.hh"
#include "BLF_api.hh"
#include "BLI_math_color.h"
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
#include "WM_types.hh"
#include "rna-runtime.hh"

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

/* Blocks and buttons: what a region's code defines, kept for one draw. JS draws text buttons being edited with its own
 * field and sends presses and edits back (region_button_press, region_button_text). */

namespace blender::ui {

/* As interface_intern.hh's ButtonFlagInternal. */
enum { UI_SELECT = 1 << 0, UI_HOVER = 1 << 2, UI_HAS_ICON = 1 << 3 };

struct Button {
  ButtonType type;
  Block *block;
  std::string str, tip;
  rctf rect;
  int icon = ICON_NONE, iconadd = 0, flag = 0, drawflag = 0, retval = 0;
  EmbossType emboss;
  float alpha_factor = 1.0f, min = 0.0f, max = 0.0f;
  PointerRNA rnapoin = {};
  PropertyRNA *rnaprop = nullptr;
  int rnaindex = -1;
  void *poin = nullptr;
  ButPointerType pointype = ButPointerType::None;
  int bit_index = -1;
  ButtonHandleFunc func = nullptr;
  void *func_arg1 = nullptr, *func_arg2 = nullptr;
  ButtonHandleNFunc funcN = nullptr;
  void *func_argN = nullptr;
  ButtonArgNFree func_argN_free_fn = nullptr;
  ButtonArgNCopy func_argN_copy_fn = nullptr;
  wmOperatorType *optype = nullptr;
  PointerRNA *opptr = nullptr;
  std::function<void(bContext &C, StringRefNull oldname)> rename_func;
  bool active_only = false;
  /* The unit its number shows (button_unit_type_set: B_UNIT_*), or none for its property's. */
  int unit_type = 0;
};

struct Block {
  std::string name;
  EmbossType emboss;
  int flag = 0;
  rctf ortho;
  Vector<std::unique_ptr<Button>> buttons;
  /* A panel's block whose buttons panel-layout.cc records into the panel's layouts (panel_block_new). */
  bool recorded_layout = false;
  /* What runs after any of its buttons applies (block_func_handle_set), with the button's return value. */
  BlockHandleFunc handle_func = nullptr;
  void *handle_arg = nullptr;
};

void layout_record_button(Block *block, int index);

}  // namespace blender::ui

static Vector<std::unique_ptr<ui::Block>> &blocks()
{
  static Vector<std::unique_ptr<ui::Block>> list;
  return list;
}

/* What the last draw's buttons are, by their index in it. */
static Vector<ui::Button *> &buttons()
{
  static Vector<ui::Button *> list;
  return list;
}

EXPORT(region_draw_end) const char *region_draw_end()
{
  static std::string json;
  json = "{\"draw\":[" + rec.draw + "],\"buttons\":[" + rec.buttons + "],\"iconColors\":{" + rec.icon_colors + "}}";
  return json.c_str();
}

namespace blender::ui {

Block *block_begin(const bContext * /*C*/, ARegion * /*region*/, std::string name, EmbossType emboss)
{
  blocks().append(std::make_unique<Block>());
  Block *block = blocks().last().get();
  block->name = std::move(name);
  block->emboss = emboss;
  block->ortho = rec.ortho;
  return block;
}

void block_emboss_set(Block *block, EmbossType emboss) { block->emboss = emboss; }
void block_flag_enable(Block *block, int flag) { block->flag |= flag; }
void block_lock_clear(Block * /*block*/) {}

static Button *button_add(Block *block, ButtonType type, int icon, StringRef str, int x, int y, short width, short height,
                          std::optional<StringRef> tip)
{
  block->buttons.append(std::make_unique<Button>());
  Button *but = block->buttons.last().get();
  but->type = type;
  but->block = block;
  but->icon = icon;
  but->str = str;
  but->tip = tip.value_or("");
  but->rect = {float(x), float(x + width), float(y), float(y + height)};
  but->emboss = block->emboss;
  if (block->recorded_layout) {
    layout_record_button(block, int(block->buttons.size()) - 1);
  }
  return but;
}

Button *uiDefBut(Block *block, ButtonTypeWithPointerType but_and_ptr_type, StringRef str, int x, int y, short width,
                 short height, void *poin, float min, float max, std::optional<StringRef> tip)
{
  Button *but = button_add(block, but_and_ptr_type.but_type, ICON_NONE, str, x, y, width, height, tip);
  but->poin = poin;
  but->pointype = but_and_ptr_type.pointer_type;
  but->bit_index = bool(but->pointype & ButPointerType::Bit) ? but_and_ptr_type.bit_index : -1;
  but->min = min;
  but->max = max;
  return but;
}

Button *uiDefIconBut(Block *block, ButtonTypeWithPointerType but_and_ptr_type, int icon, int x, int y, short width,
                     short height, void *poin, float min, float max, std::optional<StringRef> tip)
{
  Button *but = uiDefBut(block, but_and_ptr_type, "", x, y, width, height, poin, min, max, tip);
  but->icon = icon;
  return but;
}

Button *uiDefIconButR_prop(Block *block, ButtonType type, int icon, int x, int y, short width, short height,
                           PointerRNA *ptr, PropertyRNA *prop, int index, float min, float max,
                           std::optional<StringRef> tip)
{
  Button *but = button_add(block, type, icon ? icon : RNA_property_ui_icon(prop), "", x, y, width, height, tip);
  but->rnapoin = *ptr;
  but->rnaprop = prop;
  but->rnaindex = index;
  but->min = min;
  but->max = max;
  return but;
}

Button *uiDefButR(Block *block, ButtonType type, std::optional<StringRef> str, int x, int y, short width, short height,
                  PointerRNA *ptr, StringRefNull propname, int index, float min, float max, std::optional<StringRef> tip)
{
  PropertyRNA *prop = RNA_struct_find_property(ptr, propname.c_str());
  Button *but = uiDefIconButR_prop(block, type, ICON_NONE, x, y, width, height, ptr, prop, index, min, max, tip);
  but->icon = ICON_NONE;
  but->str = str.value_or(prop ? RNA_property_ui_name(prop) : "");
  return but;
}

/* An operator's button, run by its idname when pressed (JS runs it as the button's operator). */
Button *uiDefIconButO(Block *block, ButtonType type, StringRefNull opname, wm::OpCallContext /*opcontext*/, int icon, int x,
                      int y, short width, short height, std::optional<StringRef> tip)
{
  Button *but = button_add(block, type, icon, "", x, y, width, height, tip);
  but->optype = WM_operatortype_find(opname.c_str(), false);
  return but;
}
PointerRNA *button_operator_ptr_ensure(Button *but)
{
  if (!but->opptr) {
    but->opptr = MEM_new<PointerRNA>(__func__, WM_operator_properties_create_ptr(but->optype));
  }
  return but->opptr;
}

void button_funcN_set(Button *but, ButtonHandleNFunc funcN, void *argN, void *arg2, ButtonArgNFree func_argN_free_fn,
                      ButtonArgNCopy func_argN_copy_fn)
{
  but->funcN = funcN;
  but->func_argN = argN;
  but->func_arg2 = arg2;
  but->func_argN_free_fn = func_argN_free_fn;
  but->func_argN_copy_fn = func_argN_copy_fn;
}

/* A block's layout (block_layout): recorded by panel-layout.cc, and written into the draw where the block lays it out,
 * for JS to draw with the shared layout renderer. */
Layout &layout_record_begin(const char *kind);
void layout_record_align_set(const Layout &layout, bool align);
std::string layout_record_json(const Layout &layout);
void layout_record_clear();
struct BlockLayout {
  Layout *layout;
  int x, y, size;
};
static Vector<BlockLayout> block_layouts;
Layout &block_layout(Block * /*block*/, LayoutDirection /*dir*/, LayoutType type, int x, int y, int size, int /*em*/,
                     int /*padding*/, const uiStyle * /*style*/)
{
  /* As interface_layout.cc's block_layout: a header's root lays its items out in a row. */
  Layout &layout = layout_record_begin(type == LayoutType::Header ? "row" : "column");
  block_layouts.append({&layout, x, y, size});
  return layout;
}
void block_layout_set_current(Block * /*block*/, Layout * /*layout*/) {}
/* The block's alignment, recorded on the layout its items go into. */
void block_align_begin(Block * /*block*/)
{
  if (!block_layouts.is_empty()) {
    layout_record_align_set(*block_layouts.last().layout, true);
  }
}
void block_align_end(Block * /*block*/) {}
void block_bounds_set_normal(Block * /*block*/, int /*addval*/) {}
int2 block_layout_resolve(Block * /*block*/)
{
  for (const BlockLayout &block_layout : block_layouts) {
    std::string &s = command("layout");
    s += ",\"at\":[";
    number(s, block_layout.x);
    s += ',';
    number(s, block_layout.y);
    s += ',';
    number(s, block_layout.size);
    s += "],\"layout\":" + layout_record_json(*block_layout.layout) + '}';
  }
  block_layouts.clear();
  return {0, 0};
}

void button_func_set(Button *but, ButtonHandleFunc func, void *arg1, void *arg2)
{
  but->func = func;
  but->func_arg1 = arg1;
  but->func_arg2 = arg2;
}
void text_button_func_rename_set(Button *but, std::function<void(bContext &C, StringRefNull oldname)> rename_func)
{
  but->rename_func = std::move(rename_func);
}
void button_flag_enable(Button *but, int flag) { but->flag |= flag; }
void button_flag_disable(Button *but, int flag) { but->flag &= ~flag; }
void button_drawflag_enable(Button *but, int flag) { but->drawflag |= flag; }
void button_label_alpha_factor_set(Button *but, float alpha_factor) { but->alpha_factor = alpha_factor; }
void button_retval_set(Button *but, int retval) { but->retval = retval; }
void button_unit_type_set(Button *but, int unit_type) { but->unit_type = uchar(RNA_SUBTYPE_UNIT_VALUE(unit_type)); }
void block_func_handle_set(Block *block, BlockHandleFunc func, void *arg)
{
  block->handle_func = func;
  block->handle_arg = arg;
}
Button *uiDefIconTextBut(Block *block, ButtonTypeWithPointerType but_and_ptr_type, int icon, StringRef str, int x, int y,
                         short width, short height, void *poin, std::optional<StringRef> tip)
{
  Button *but = uiDefBut(block, but_and_ptr_type, str, x, y, width, height, poin, 0.0f, 0.0f, tip);
  but->icon = icon;
  return but;
}
void button_disable(Button *but, const char * /*disabled_hint*/) { but->flag |= BUT_DISABLED; }

/* port-override: JS applies a button within the event that pressed it, so none stays active, nor shows a tooltip. */
Button *context_active_but_get(const bContext * /*C*/) { return nullptr; }
void button_tooltip_timer_remove(bContext * /*C*/, Button * /*but*/) {}

/* Whether a text button is being edited: JS edits it in its own field until it applies or cancels the edit. */
static bool text_edit_cancelled = false;
bool button_active_only(const bContext * /*C*/, ARegion * /*region*/, Block * /*block*/, Button *but)
{
  but->active_only = !std::exchange(text_edit_cancelled, false);
  return but->active_only;
}

/* A button's value: its RNA property's, or its pointer's (a bit of it, for a bit button). */
static double button_value(const Button *but)
{
  if (but->rnaprop) {
    PointerRNA ptr = but->rnapoin;
    switch (RNA_property_type(but->rnaprop)) {
      case PROP_BOOLEAN:
        return RNA_property_array_check(but->rnaprop) ?
                   RNA_property_boolean_get_index(&ptr, but->rnaprop, but->rnaindex) :
                   RNA_property_boolean_get(&ptr, but->rnaprop);
      case PROP_INT:
        return RNA_property_int_get(&ptr, but->rnaprop);
      case PROP_ENUM:
        return RNA_property_enum_get(&ptr, but->rnaprop);
      default:
        return RNA_property_float_get(&ptr, but->rnaprop);
    }
  }
  if (!but->poin) {
    return 0.0;
  }
  const ButPointerType type = but->pointype & ~ButPointerType::Bit;
  const long long word = type == ButPointerType::Char  ? *static_cast<const char *>(but->poin) :
                         type == ButPointerType::Short ? *static_cast<const short *>(but->poin) :
                         type == ButPointerType::Int   ? *static_cast<const int *>(but->poin) :
                                                         0;
  if (type == ButPointerType::Float) {
    return *static_cast<const float *>(but->poin);
  }
  return but->bit_index >= 0 ? double((word >> but->bit_index) & 1) : double(word);
}

static void button_value_set(Button *but, double value)
{
  if (but->rnaprop) {
    PointerRNA ptr = but->rnapoin;
    if (RNA_property_array_check(but->rnaprop)) {
      RNA_property_boolean_set_index(&ptr, but->rnaprop, but->rnaindex, value != 0.0);
    }
    else if (RNA_property_type(but->rnaprop) == PROP_BOOLEAN) {
      RNA_property_boolean_set(&ptr, but->rnaprop, value != 0.0);
    }
    else {
      RNA_property_int_set(&ptr, but->rnaprop, int(value));
    }
    return;
  }
  const ButPointerType type = but->pointype & ~ButPointerType::Bit;
  auto store = [&](auto *p) {
    using T = std::remove_reference_t<decltype(*p)>;
    *p = but->bit_index >= 0 ? T(value != 0.0 ? (*p | (1 << but->bit_index)) : (*p & ~(1 << but->bit_index))) : T(value);
  };
  if (type == ButPointerType::Char) {
    store(static_cast<char *>(but->poin));
  }
  else if (type == ButPointerType::Short) {
    store(static_cast<short *>(but->poin));
  }
  else if (type == ButPointerType::Int) {
    store(static_cast<int *>(but->poin));
  }
}

static bool button_is_toggle(const Button *but)
{
  return ELEM(but->type, ButtonType::IconToggle, ButtonType::IconToggleN, ButtonType::Toggle, ButtonType::ToggleN,
              ButtonType::Checkbox, ButtonType::CheckboxN);
}

/* As interface.cc's but_update_select_flag and but_update_ex set them for toggles: selected when on, and the icon
 * that shows it. */
static void button_update(Button *but)
{
  if (!button_is_toggle(but)) {
    return;
  }
  const bool on = button_value(but) != 0.0;
  const bool negative = ELEM(but->type, ButtonType::IconToggleN, ButtonType::ToggleN, ButtonType::CheckboxN);
  SET_FLAG_FROM_TEST(but->flag, on != negative, UI_SELECT);
  if (ELEM(but->type, ButtonType::IconToggle, ButtonType::IconToggleN) &&
      (!but->rnaprop || (RNA_property_flag(but->rnaprop) & PROP_ICONS_CONSECUTIVE)))
  {
    if (but->rnaprop && (RNA_property_flag(but->rnaprop) & PROP_ICONS_REVERSE)) {
      but->drawflag |= BUT_ICON_REVERSE;
    }
    but->iconadd = (but->flag & UI_SELECT) ? 1 : 0;
  }
}

/* As interface_query.cc's button_icon. */
static int button_icon(const Button *but)
{
  return (but->drawflag & BUT_ICON_REVERSE) ? but->icon - but->iconadd : but->icon + but->iconadd;
}

void block_end(const bContext * /*C*/, Block *block)
{
  for (std::unique_ptr<Button> &but : block->buttons) {
    if (but->icon) {
      but->flag |= UI_HAS_ICON;
    }
    button_update(but.get());
  }
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
    alpha *= but->alpha_factor;
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

void block_draw(const bContext * /*C*/, Block *block)
{
  const rctf ortho = std::exchange(rec.ortho, block->ortho);
  for (std::unique_ptr<Button> &but : block->buttons) {
    button_draw(but.get());
    std::string &s = rec.buttons;
    if (!s.empty()) {
      s += ',';
    }
    char head[96];
    SNPRINTF(head, "{\"index\":%d,\"type\":%d,\"flag\":%d,\"retval\":%d", int(buttons().size()), int(but->type), but->flag, but->retval);
    s += head;
    points_json(s, "rect", {{but->rect.xmin, but->rect.ymin}, {but->rect.xmax, but->rect.ymax}});
    if (!but->tip.empty()) {
      string_json(s += ",\"tip\":", but->tip);
    }
    if (but->type == ButtonType::Text) {
      string_json(s += ",\"text\":", but->poin ? static_cast<const char *>(but->poin) : but->str.c_str());
      number(s += ",\"maxlength\":", but->max);
    }
    if (but->active_only) {
      s += ",\"active\":true";
    }
    if (but->optype) {
      string_json(s += ",\"operator\":", but->optype->idname);
    }
    if (button_is_toggle(but.get())) {
      s += (but->flag & UI_SELECT) ? ",\"selected\":true" : ",\"selected\":false";
    }
    s += '}';
    buttons().append(but.get());
  }
  rec.ortho = ortho;
}

}  // namespace blender::ui

/* What a button owns: its function's argument and its operator's properties. */
static void button_free(ui::Button *but)
{
  if (but->func_argN && but->func_argN_free_fn) {
    but->func_argN_free_fn(but->func_argN);
  }
  if (but->opptr) {
    WM_operator_properties_free(but->opptr);
    MEM_delete(but->opptr);
  }
}

/* The block of the panels last recorded (panel-layout.cc's panel_record), whose buttons stay until the next ones. */
static std::unique_ptr<ui::Block> panel_block;
namespace blender::ui {
Block *panel_block_new()
{
  if (panel_block) {
    for (std::unique_ptr<Button> &but : panel_block->buttons) {
      button_free(but.get());
    }
  }
  panel_block = std::make_unique<Block>();
  panel_block->emboss = EmbossType::Emboss;
  panel_block->recorded_layout = true;
  return panel_block.get();
}
/* A recorded panel's button as JSON: its type, icon, text, tooltip and operator. */
std::string panel_button_json(int index)
{
  const Button &but = *panel_block->buttons[index];
  std::string s;
  char head[96];
  /* Its width in UI units: a button one unit wide shows its icon or box alone, its text clipped. */
  SNPRINTF(head, "{\"index\":%d,\"type\":%d,\"icon\":%d,\"units\":%.2f", index, int(but.type), but.icon,
           BLI_rctf_size_x(&but.rect) / UI_UNIT_X);
  s += head;
  string_json(s += ",\"text\":", but.str);
  if (!but.tip.empty()) {
    string_json(s += ",\"tip\":", but.tip);
  }
  if (but.optype) {
    string_json(s += ",\"operator\":", but.optype->idname);
  }
  if (but.rnaprop) {
    /* A property's button (uiDefButR): its struct type, owner ID and data, property and element, and unit. */
    char rna[160];
    SNPRINTF(rna, ",\"pointer\":[%lu,%lu,%lu],\"owner\":\"%s\",\"element\":%d,\"unit\":%d", (unsigned long)uintptr_t(but.rnapoin.type),
             (unsigned long)uintptr_t(but.rnapoin.owner_id), (unsigned long)uintptr_t(but.rnapoin.data),
             RNA_struct_identifier(but.rnapoin.type), but.rnaindex, but.unit_type);
    s += rna;
    string_json(s += ",\"prop\":", RNA_property_identifier(but.rnaprop));
  }
  return s + '}';
}
}  // namespace blender::ui

/* Starts recording a region's draw, `winx` by `winy` pixels; the last draw's buttons go. */
EXPORT(region_draw_begin) void region_draw_begin(int winx, int winy)
{
  for (ui::Button *but : buttons()) {
    button_free(but);
  }
  ui::layout_record_clear();
  buttons().clear();
  blocks().clear();
  rec = {};
  rec.winx = winx;
  rec.winy = winy;
  rec.ortho = {0.0f, float(winx), 0.0f, float(winy)};
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

/* As interface_handlers.cc applies a button: its new value, its function, then its RNA property's update. A toggle
 * takes `value` (0 or 1), or flips when it is -1. Returns the toggle's value after. */
static int button_press(bContext *C, ui::Button *but, int value, int modifier)
{
  event_modifier_set(C, modifier);
  if (ui::button_is_toggle(but)) {
    const bool negative = ELEM(but->type, ui::ButtonType::IconToggleN, ui::ButtonType::ToggleN, ui::ButtonType::CheckboxN);
    const bool on = value < 0 ? !(but->flag & ui::UI_SELECT) : value != 0;
    ui::button_value_set(but, on != negative);
  }
  if (but->func) {
    but->func(C, but->func_arg1, but->func_arg2);
  }
  if (but->funcN) {
    but->funcN(C, but->func_argN, but->func_arg2);
  }
  if (but->block->handle_func) {
    but->block->handle_func(C, but->block->handle_arg, but->retval);
  }
  if (but->rnaprop) {
    RNA_property_update(C, &but->rnapoin, but->rnaprop);
  }
  ui::button_update(but);
  event_modifier_set(C, 0);
  return (but->flag & ui::UI_SELECT) ? 1 : 0;
}
EXPORT(region_button_press) int region_button_press(bContext *C, int index, int value, int modifier)
{
  return button_press(C, buttons()[index], value, modifier);
}
/* A button of the panels last recorded, pressed. */
EXPORT(panel_button_press) int panel_button_press(bContext *C, int index, int value, int modifier)
{
  return button_press(C, panel_block->buttons[index].get(), value, modifier);
}
/* What runs after a recorded panel's property button set its value (rna_set): its functions and its block's. */
EXPORT(panel_button_applied) void panel_button_applied(bContext *C, int index)
{
  ui::Button *but = panel_block->buttons[index].get();
  if (but->func) {
    but->func(C, but->func_arg1, but->func_arg2);
  }
  if (but->funcN) {
    but->funcN(C, but->func_argN, but->func_arg2);
  }
  if (but->block->handle_func) {
    but->block->handle_func(C, but->block->handle_arg, but->retval);
  }
}

/* Applies a text button's edit (its new text), or cancels it (null), as its text editing ends. */
EXPORT(region_button_text) void region_button_text(bContext *C, int index, const char *text)
{
  ui::Button *but = buttons()[index];
  if (!text) {
    ui::text_edit_cancelled = true;
    return;
  }
  const std::string oldname = static_cast<const char *>(but->poin);
  BLI_strncpy(static_cast<char *>(but->poin), text, size_t(but->max));
  if (but->rename_func) {
    but->rename_func(*C, oldname);
  }
  if (but->func) {
    but->func(C, but->func_arg1, but->func_arg2);
  }
}
