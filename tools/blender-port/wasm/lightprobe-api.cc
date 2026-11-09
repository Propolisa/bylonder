/* A volume light probe's baked cache (Object.lightprobe_cache), which RNA does not expose: read for the view's
 * irradiance atlas (src/draw/light-probes.js) and written by its bake, as eevee_lightcache.cc hands EEVEE's result to the
 * original object, so the bake saves in the .blend. */

#include "BKE_lightprobe.h"
#include "DEG_depsgraph.hh"
#include "DNA_lightprobe_types.h"
#include "DNA_object_types.h"
#include "MEM_guardedalloc.h"

#include <cstring>

using namespace blender;

#define EXPORT(name) extern "C" __attribute__((export_name(#name)))

/* The cache's arrays as JS reads them: size, then the irradiance (float[3] per sample), visibility (float per sample)
 * and validity (uint8 per sample) pointers; null when the object has no baked uniform grid. */
struct GridCache {
  int size[3];
  const float *irradiance[4];
  const float *visibility[4];
  const uint8_t *validity;
};

EXPORT(object_lightprobe_cache) const GridCache *object_lightprobe_cache(const Object *ob)
{
  static GridCache result;
  const LightProbeGridCacheFrame *cache = ob->lightprobe_cache ? ob->lightprobe_cache->grid_static_cache : nullptr;
  if (!cache || cache->data_layout != LIGHTPROBE_CACHE_UNIFORM_GRID || !cache->irradiance.L0) {
    return nullptr;
  }
  std::memcpy(result.size, cache->size, sizeof(result.size));
  const LightProbeIrradianceData &irradiance = cache->irradiance;
  const LightProbeVisibilityData &visibility = cache->visibility;
  const float *irradiance_bands[4] = {&irradiance.L0[0][0], &irradiance.L1_a[0][0], &irradiance.L1_b[0][0], &irradiance.L1_c[0][0]};
  const float *visibility_bands[4] = {visibility.L0, visibility.L1_a, visibility.L1_b, visibility.L1_c};
  std::memcpy(result.irradiance, irradiance_bands, sizeof(irradiance_bands));
  std::memcpy(result.visibility, visibility_bands, sizeof(visibility_bands));
  result.validity = cache->connectivity.validity;
  return &result;
}

/* A new cache of `size` samples on the original object, its arrays allocated as read_result_packed allocates them, for
 * JS to fill (the returned GridCache's pointers) before object_lightprobe_cache_done. */
EXPORT(object_lightprobe_cache_new) const GridCache *object_lightprobe_cache_new(Object *ob, int x, int y, int z)
{
  BKE_lightprobe_cache_free(ob);
  BKE_lightprobe_cache_create(ob);
  LightProbeGridCacheFrame *cache = BKE_lightprobe_grid_cache_frame_create();
  const int64_t count = int64_t(x) * y * z;
  cache->size[0] = x;
  cache->size[1] = y;
  cache->size[2] = z;
  cache->irradiance.L0 = MEM_new_array_zeroed<float[3]>(count, __func__);
  cache->irradiance.L1_a = MEM_new_array_zeroed<float[3]>(count, __func__);
  cache->irradiance.L1_b = MEM_new_array_zeroed<float[3]>(count, __func__);
  cache->irradiance.L1_c = MEM_new_array_zeroed<float[3]>(count, __func__);
  cache->visibility.L0 = MEM_new_array_zeroed<float>(count, __func__);
  cache->visibility.L1_a = MEM_new_array_zeroed<float>(count, __func__);
  cache->visibility.L1_b = MEM_new_array_zeroed<float>(count, __func__);
  cache->visibility.L1_c = MEM_new_array_zeroed<float>(count, __func__);
  cache->connectivity.validity = MEM_new_array_zeroed<uint8_t>(count, __func__);
  ob->lightprobe_cache->cache_type = LIGHTPROBE_CACHE_TYPE_STATIC;
  ob->lightprobe_cache->grid_static_cache = cache;
  return object_lightprobe_cache(ob);
}

/* The filled cache propagated to the evaluated object, as eevee_lightcache.cc does. */
EXPORT(object_lightprobe_cache_done) void object_lightprobe_cache_done(Object *ob)
{
  DEG_id_tag_update(&ob->id, ID_RECALC_SYNC_TO_EVAL | ID_RECALC_SHADING);
}
