/* Blender's textures (Tex, the ID Properties > Texture edits and modifiers sample) and color ramps: a texture in Main per Bylonder texture,
 * and ones outside Main for an evaluation in a module of its own (a worker, the modifier kernels polyfill). JS writes
 * their settings at their DNA fields (dna-textures.json). Sampling is Blender's (BKE_texture_get_value: multitex, with
 * BLI noise for the procedural types), as the Displace, Wave and Warp modifiers sample. */
#include <algorithm>

#include "BKE_colorband.hh"
#include "BKE_image.hh"
#include "BKE_lib_id.hh"
#include "BKE_texture.h"
#include "BLI_math_vector.h"
#include "MEM_guardedalloc.h"
#include "DNA_modifier_types.h"
#include "DNA_texture_types.h"
#include "RE_texture.h"

using namespace blender;

#define EXPORT(name) extern "C" __attribute__((export_name(#name)))

void types_ensure();

EXPORT(texture_add) Tex *texture_add(Main *bmain, const char *name) { return BKE_texture_add(bmain, name); }
EXPORT(texture_new) Tex *texture_new()
{
  types_ensure();
  return BKE_id_new_nomain<Tex>("Texture");
}
EXPORT(texture_free) void texture_free(Tex *tex) { BKE_id_free(nullptr, tex); }
/* Its users: a texture outside Main is freed once no modifier uses it. */
EXPORT(texture_users) int texture_users(const Tex *tex) { return tex->id.us; }

/* A modifier's texture (MappingInfoModifierData: Displace, Wave, Warp and the vertex weight modifiers), a user of it
 * as RNA's pointer set makes, which freeing the modifier gives back. */
EXPORT(modifier_texture_set) void modifier_texture_set(ModifierData *md, Tex *tex)
{
  MappingInfoModifierData *mapping = reinterpret_cast<MappingInfoModifierData *>(md);
  id_us_min(id_cast<ID *>(mapping->texture));
  mapping->texture = tex;
  id_us_plus(id_cast<ID *>(tex));
}

/* The texture at a point, as a modifier reads it: intensity, then RGBA. */
EXPORT(texture_value) void texture_value(Tex *tex, const float co[3], float r_value[5])
{
  TexResult result;
  BKE_texture_get_value(tex, co, &result, false);
  r_value[0] = result.tin;
  copy_v4_v4(&r_value[1], result.trgba);
}

/* A color ramp's table as GPU_color_band samples it (BKE_colorband_evaluate_table_rgba): its stops as r, g, b, a and
 * position each, in order, and its interpolation, hue interpolation and color mode (DNA_colorband_types.h). Writes 257
 * RGBA colors. */
EXPORT(colorband_table)
void colorband_table(int tot, const float *stops, int ipotype, int ipotype_hue, int color_mode, float *r_table)
{
  ColorBand coba;
  coba.tot = short(tot);
  coba.ipotype = eColorBand_Interp(ipotype);
  coba.ipotype_hue = eColorBand_HueInterp(ipotype_hue);
  coba.color_mode = eColorBand_ColorMode(color_mode);
  for (int i = 0; i < tot; i++) {
    const float *stop = &stops[i * 5];
    coba.data[i] = {stop[0], stop[1], stop[2], stop[3], stop[4], i};
  }
  float *table;
  int size;
  BKE_colorband_evaluate_table_rgba(&coba, &table, &size);
  std::copy_n(table, size * 4, r_table);
  MEM_delete(table);
}

namespace blender {

/* port-override: image.cc does not build for wasm32 (it shifts a size_t by 32) and the module has no images, so a
 * texture's image pool holds none (the procedural types read no images). */
ImagePool *BKE_image_pool_new() { return nullptr; }
void BKE_image_pool_free(ImagePool * /*pool*/) {}
ImBuf *BKE_image_pool_acquire_ibuf(Image * /*ima*/, ImageUser * /*iuser*/, ImagePool * /*pool*/) { return nullptr; }
void BKE_image_pool_release_ibuf(Image * /*ima*/, ImBuf * /*ibuf*/, ImagePool * /*pool*/) {}
/* As image.cc defines it, for a new texture's image user. */
void BKE_imageuser_default(ImageUser *iuser)
{
  *iuser = ImageUser{};
  iuser->frames = 100;
  iuser->sfra = 1;
}

}  // namespace blender
