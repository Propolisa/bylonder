// An Irradiance Volume's baked light cache where Blender keeps it, Object.lightprobe_cache (DNA's LightProbeGridCacheFrame:
// L0 and L1 irradiance in RGB, their visibility, a validity per sample), which RNA does not expose: read and written
// through tools/blender-port/wasm/lightprobe-api.cc, so a bake saves in the .blend and a file EEVEE baked opens with its bake.
import { blenderModule } from '../bmesh/bmesh-wasm.js';

const { exports: x } = blenderModule;
// A cache's identity for the views: a write gives the same object new arrays, maybe at the addresses it had.
let writes = 0;

// GridCache (lightprobe-api.cc): int size[3], then pointers to the irradiance (4 bands of RGB), visibility (4 bands)
// and validity (a byte a sample); null for an object without a baked uniform grid.
export function readCache(ob) {
  const at = x.object_lightprobe_cache(ob) >>> 0;
  if (!at) return null;
  const words = new Uint32Array(x.memory.buffer, at >>> 0, 12), size = Array.from(new Int32Array(x.memory.buffer, at >>> 0, 3));
  const n = size[0] * size[1] * size[2];
  const floats = (p, length) => (p ? new Float32Array(x.memory.buffer, p >>> 0, length).slice() : null);
  const visibility = [7, 8, 9, 10].map((i) => floats(words[i], n));
  return {
    size, key: `${words[3]}:${words[11]}:${writes}`,
    irradiance: [3, 4, 5, 6].map((i) => floats(words[i], n * 3)),
    visibility: visibility.every(Boolean) ? visibility : null,
    validity: words[11] ? new Uint8Array(x.memory.buffer, words[11] >>> 0, n).slice() : null,
  };
}

// Replaces the object's cache with `cache` ({ size, irradiance, visibility, validity } as readCache gives), as
// eevee_lightcache.cc hands a bake to the original object, and tags it for the depsgraph.
export function writeCache(ob, cache) {
  writes++;
  const at = x.object_lightprobe_cache_new(ob, ...cache.size) >>> 0, words = new Uint32Array(x.memory.buffer, at >>> 0, 12);
  cache.irradiance.forEach((data, k) => new Float32Array(x.memory.buffer, words[3 + k] >>> 0, data.length).set(data));
  cache.visibility.forEach((data, k) => new Float32Array(x.memory.buffer, words[7 + k] >>> 0, data.length).set(data));
  new Uint8Array(x.memory.buffer, words[11] >>> 0, cache.validity.length).set(cache.validity);
  x.object_lightprobe_cache_done(ob);
}
