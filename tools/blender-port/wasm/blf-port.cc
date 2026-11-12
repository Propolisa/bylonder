/* Blender's font code the module runs over the page's fonts (region-draw.cc measures and draws text with them): text
 * wrapped to a width, and SVG icons rasterized by Blender's nanosvg. Derived from Blender's blenfont (GPL-2.0-or-later). */
#include <cfloat>
#include <cmath>
#include <string>

#include "BLF_api.hh"
#include "BLI_array.hh"
#include "BLI_function_ref.hh"
#include "BLI_math_color.h"
#include "BLI_path_utils.hh"
#include "BLI_string_ref.hh"
#include "BLI_string_utf8.h"
#include "BLI_utildefines.h"
#include "BLI_vector.hh"
#include "nanosvg.h"
#include "nanosvgrast.h"

#define IMPORT(name) extern "C" __attribute__((import_module("env"), import_name(#name)))
/* An icon's SVG source by its name, its bytes into `out` when they fit; its length in bytes. */
IMPORT(region_icon_svg) int region_icon_svg(const char *name, char *out, int capacity);
extern "C" const char *ui_icon_name(int icon);

namespace blender {

/* blender-port: blf_font.cc blf_font_wrap_apply and blf_font_string_wrap: a string's lines within a width (a File
 * Browser thumbnail's name). port-override: each glyph's right edge is measured as the browser draws the text, as there
 * are no glyph advances without FreeType. */
Vector<StringRef> BLF_string_wrap(int fontid, StringRef str, const int max_pixel_width, BLFWrapMode mode)
{
  Vector<StringRef> lines;
  const char *text = str.data();
  const size_t len = size_t(str.size());
  const float limit = max_pixel_width != -1 ? float(max_pixel_width) : FLT_MAX;
  const auto width = [&](size_t from, size_t to) { return to > from ? BLF_width(fontid, text + from, to - from) : 0.0f; };
  size_t start = 0, last[2] = {0, 0}, clip = 0, i = 0;
  uint prev = 0;
  while (i < len && text[i]) {
    const size_t i_curr = i;
    const uint c = BLI_str_utf8_as_unicode_step_safe(text, len, &i);
    const bool glyph = c != '\n';
    const bool overflows = glyph && width(start, i) >= limit && i_curr != start;
    bool draw = false;
    if (overflows && start != last[0]) {
      draw = true;
    }
    else if (bool(mode & BLFWrapMode::HardLimit) && overflows) {
      last[0] = last[1] = i_curr;
      draw = true;
      clip = 0;
    }
    else if (!(i < len && text[i])) {
      last[0] = i + (c != '\n' ? 1 : 0);
      last[1] = i;
      draw = true;
      clip = 0;
    }
    else if (c == '\n') {
      last[0] = i_curr + 1;
      last[1] = i;
      draw = true;
      clip = 1;
    }
    else if (c != ' ' && prev == ' ') {
      last[0] = last[1] = i_curr;
      clip = 1;
    }
    else if (bool(mode & BLFWrapMode::Path)) {
      if (ELEM(c, SEP, ' ', '?', '&', '=')) {
        last[0] = last[1] = i;
        clip = 0;
      }
      else if (ELEM(c, '-', '_', '.', '%')) {
        last[0] = last[1] = i_curr;
        clip = 0;
      }
    }
    else if (bool(mode & BLFWrapMode::Typographical) && !BLI_str_utf32_char_is_breaking_space(c) &&
             BLI_str_utf32_char_is_breaking_space(prev))
    {
      last[0] = last[1] = i_curr;
      clip = BLI_str_utf8_from_unicode_len(prev);
    }
    else if (bool(mode & BLFWrapMode::Typographical) && BLI_str_utf32_char_is_optional_break_after(c, prev)) {
      last[0] = last[1] = i;
      clip = 0;
    }
    else if (bool(mode & BLFWrapMode::Typographical) && BLI_str_utf32_char_is_optional_break_before(c, prev)) {
      last[0] = last[1] = i_curr;
      clip = 0;
    }
    if (draw) {
      lines.append(StringRef(text + start, std::min(last[0] - start - clip, len - start)));
      start = last[0];
      i = last[1];
      prev = 0;
      continue;
    }
    prev = glyph ? c : 0;
  }
  return lines;
}

/* blender-port: blf_glyph.cc blf_glyph_cache_add_svg and blf.cc BLF_svg_icon_bitmap. An SVG icon as a bitmap (an alert's, About's logo, the File Browser's folder): blf_glyph.cc
 * blf_glyph_cache_add_svg and blf.cc BLF_svg_icon_bitmap, its source from the page's icons (region_icon_svg, as
 * BLF_draw_svg_icon draws them) where Blender's are compiled in (svg_icons.cc), rasterized by Blender's nanosvg. */
Array<uchar> BLF_svg_icon_bitmap(uint icon_id,
                                 float size,
                                 int *r_width,
                                 int *r_height,
                                 bool multicolor,
                                 FunctionRef<void(std::string &)> edit_source_cb)
{
  *r_width = *r_height = 0;
  const char *name = ui_icon_name(int(icon_id));
  std::string svg(size_t(region_icon_svg(name, nullptr, 0)), '\0');
  region_icon_svg(name, svg.data(), int(svg.size()));
  if (svg.empty()) {
    return {};
  }
  if (edit_source_cb) {
    edit_source_cb(svg);
  }
  NSVGimage *image = nsvgParse(svg.data(), "px", 96.0f);
  if (!image || image->width == 0 || image->height == 0) {
    nsvgDelete(image);
    return {};
  }
  NSVGrasterizer *rast = nsvgCreateRasterizer();
  float scale = size / 1600.0f;
  const int w = int(ceil(image->width * scale)), h = int(ceil(image->height * scale));
  scale = float(w) / image->width;
  Array<uchar> bitmap(w * h * 4);
  nsvgRasterize(rast, image, 0.0f, 0.0f, scale, bitmap.data(), w, h, w * 4);
  nsvgDeleteRasterizer(rast);
  nsvgDelete(image);
  /* A monochrome icon as its coverage in every channel. */
  if (!multicolor) {
    for (int64_t i = 0; i < int64_t(w) * h; i++) {
      uchar *px = &bitmap[i * 4];
      const uchar coverage = uchar(float(srgb_to_grayscale_byte(px)) * (float(px[3]) / 255.0f));
      px[0] = px[1] = px[2] = px[3] = coverage;
    }
  }
  *r_width = w;
  *r_height = h;
  return bitmap;
}


}  // namespace blender
