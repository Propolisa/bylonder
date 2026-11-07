/* What Blender's GPU material code asks of Blender's data for shader nodes (node_shader_*.cc, draw_resource.hh), for
 * the Babylon blocks that run them (src/nodes/blender/shader-nodes.js): curve mapping tables and their parameters, the
 * blackbody and wavelength tables, the Sky Texture's precomputed sky, an object's random value, and the uniform
 * attributes of an object or view layer. */
#include <algorithm>
#include <cmath>

#include "BKE_colortools.hh"
#include "BKE_duplilist.hh"
#include "BLI_hash.h"
#include "DNA_color_types.h"
#include "DNA_object_types.h"
#include "IMB_colormanagement.hh"
#include "GPU_material.hh"
#include "MEM_guardedalloc.h"
#include "sky_nishita.h"

using namespace blender;

#define EXPORT(name) extern "C" __attribute__((export_name(#name)))

/* A curve mapping's GPU table and parameters as gpu_shader_curve_rgb and its kin link them: its four curves' points
 * (x, y and flag each, `counts` per curve), its flag (CUMA_DO_CLIP, CUMA_EXTEND_EXTRAPOLATE) and clipping rectangle
 * (xmin, ymin, xmax, ymax). Writes the table (`r_size` RGBA texels, at most 1024), then 16 floats: range minimums,
 * range dividers, start slopes and end slopes, and per curve whether it maps identity (4 more). */
EXPORT(curvemapping_gpu)
int curvemapping_gpu(const float *points, const int counts[4], int flag, const float clipr[4], float *r_table, float *r_params)
{
  CurveMapping *cumap = BKE_curvemapping_add(4, 0.0f, 0.0f, 1.0f, 1.0f);
  cumap->flag = eCurveMappingFlags(flag);
  cumap->clipr = {clipr[0], clipr[2], clipr[1], clipr[3]};
  cumap->curr = cumap->clipr;
  for (int i = 0; i < 4; i++) {
    CurveMap &cuma = cumap->cm[i];
    MEM_delete(cuma.curve);
    cuma.totpoint = short(counts[i]);
    cuma.curve = MEM_new_array<CurveMapPoint>(size_t(counts[i]), __func__);
    for (int p = 0; p < counts[i]; p++, points += 3) {
      cuma.curve[p].x = points[0];
      cuma.curve[p].y = points[1];
      cuma.curve[p].flag = eCurveMapPoint_Flag(points[2]);
    }
  }
  BKE_curvemapping_changed_all(cumap);
  BKE_curvemapping_init(cumap);
  float *table;
  int size;
  BKE_curvemapping_table_RGBA(cumap, &table, &size);
  std::copy_n(table, std::min(size, 1024) * 4, r_table);
  MEM_delete(table);
  BKE_curvemapping_get_range_minimums(cumap, r_params);
  BKE_curvemapping_compute_range_dividers(cumap, r_params + 4);
  BKE_curvemapping_compute_slopes(cumap, r_params + 8, r_params + 12);
  for (int i = 0; i < 4; i++) {
    r_params[16 + i] = BKE_curvemapping_is_map_identity(cumap, i);
  }
  BKE_curvemapping_free(cumap);
  return std::min(size, 1024);
}

/* blender-port: node_shader_tex_sky.cc sky_simplify_multiscatter_elevation_rotation (static there): the sun's
 * elevation in [-PI/2, PI/2] and its rotation in [0, 2PI], as the shader reads them. */
static void sky_simplify_multiscatter_elevation_rotation(float &sun_elevation, float &sun_rotation)
{
  float new_sun_elevation = fmodf(sun_elevation, 2.0f * float(M_PI));
  float new_sun_rotation = sun_rotation;
  if (fabsf(new_sun_elevation) >= float(M_PI)) {
    new_sun_elevation -= copysignf(2.0f, new_sun_elevation) * float(M_PI);
  }
  if (new_sun_elevation >= float(M_PI) / 2.0f || new_sun_elevation <= -float(M_PI) / 2.0f) {
    new_sun_elevation = copysignf(float(M_PI), new_sun_elevation) - new_sun_elevation;
    new_sun_rotation += float(M_PI);
  }
  new_sun_rotation = fmodf(new_sun_rotation, 2.0f * float(M_PI));
  if (new_sun_rotation < 0.0f) {
    new_sun_rotation += 2.0f * float(M_PI);
  }
  sun_elevation = new_sun_elevation;
  sun_rotation = 2.0f * float(M_PI) - new_sun_rotation;
}

/* node_shader_gpu_tex_sky's Single and Multiple Scattering skies: the texture GPU_image_sky holds
 * (GPU_SKY_WIDTH x GPU_SKY_HEIGHT RGBA texels of XYZ) and node_tex_sky_nishita's parameters: its sky type, sun
 * rotation and XYZ to scene linear rows (get_XYZ_to_RGB_for_gpu), 11 floats. Returns the texture's width times 65536
 * plus its height; null pixels compute only that. */
EXPORT(sky_texture_gpu)
int sky_texture_gpu(int multiple_scattering, float sun_elevation, float sun_rotation, float altitude, float air_density,
                    float aerosol_density, float ozone_density, float *r_pixels, float *r_params)
{
  if (r_pixels) {
    if (multiple_scattering) {
      sky_simplify_multiscatter_elevation_rotation(sun_elevation, sun_rotation);
      SKY_multiple_scattering_precompute_texture(r_pixels, 4, GPU_SKY_WIDTH, GPU_SKY_HEIGHT, sun_elevation, altitude,
                                                 air_density, aerosol_density, ozone_density);
    }
    else {
      SKY_single_scattering_precompute_texture(r_pixels, 4, GPU_SKY_WIDTH, GPU_SKY_HEIGHT, sun_elevation, altitude,
                                               air_density, aerosol_density, ozone_density);
      sun_rotation = fmodf(sun_rotation, 2.0f * float(M_PI));
      if (sun_rotation < 0.0f) {
        sun_rotation += 2.0f * float(M_PI);
      }
      sun_rotation = 2.0f * float(M_PI) - sun_rotation;
    }
    const float3x3 xyz_to_rgb = IMB_colormanagement_get_xyz_to_scene_linear();
    r_params[0] = multiple_scattering ? 1.0f : 0.0f;
    r_params[1] = sun_rotation;
    for (int row = 0; row < 3; row++) {
      for (int k = 0; k < 3; k++) {
        r_params[2 + row * 3 + k] = xyz_to_rgb[k][row];
      }
    }
  }
  return GPU_SKY_WIDTH * 65536 + GPU_SKY_HEIGHT;
}

/* node_shader_gpu_blackbody's and node_shader_gpu_wavelength's tables: CM_TABLE + 1 RGBA texels. */
EXPORT(blackbody_table) void blackbody_table(float *r_table)
{
  IMB_colormanagement_blackbody_temperature_to_rgb_table(r_table, CM_TABLE + 1, 800.0f, 12000.0f);
}
EXPORT(wavelength_table) void wavelength_table(float *r_table)
{
  IMB_colormanagement_wavelength_to_rgb_table(r_table, CM_TABLE + 1);
}

/* blender-port: draw_handle.hh ObjectRef::random, for an object drawn outside a dupli list. */
EXPORT(object_random) float object_random(const Object *ob)
{
  return BLI_hash_int_2d(BLI_hash_string(ob->id.name + 2), 0) * (1.0f / float(0xFFFFFFFF));
}

/* The Attribute node's Object and Instancer types (an object drawn outside a dupli list), and its View Layer type. */
EXPORT(object_rgba_attribute) bool object_rgba_attribute(const Object *ob, const char *name, float r_value[4])
{
  return BKE_object_dupli_find_rgba_attribute(ob, nullptr, nullptr, name, r_value);
}
EXPORT(view_layer_rgba_attribute)
bool view_layer_rgba_attribute(const Scene *scene, const ViewLayer *layer, const char *name, float r_value[4])
{
  return BKE_view_layer_find_rgba_attribute(scene, layer, name, r_value);
}
