// The sky Blender precomputes for a Sky Texture's Single and Multiple Scattering models (node_shader_gpu_tex_sky,
// intern/sky), from the module (shader-node-api.cc sky_texture_gpu): its texels of XYZ and node_tex_sky_nishita's
// parameters (sky type, sun rotation, the XYZ to scene linear rows). The last few skies are kept, by their settings.
import { blenderModule } from '../bmesh/bmesh-wasm.js';

const { exports: x, withArrays } = blenderModule;
const KEPT = 8, skies = new Map();

// null where the module has no sky (built before it).
export function skyTexture(p) {
  if (!x.sky_texture_gpu) return null;
  const args = [p.sky_type === 'MULTIPLE_SCATTERING' ? 1 : 0, p.sun_elevation, p.sun_rotation, p.altitude, p.air_density, p.aerosol_density, p.ozone_density];
  const key = args.join();
  if (!skies.has(key)) {
    const size = x.sky_texture_gpu(...args, 0, 0), width = size >>> 16, height = size & 0xffff;
    skies.set(key, withArrays([new Float32Array(width * height * 4), new Float32Array(11)], ([pixels, params]) => {
      x.sky_texture_gpu(...args, pixels, params);
      const read = (pointer, length) => new Float32Array(x.memory.buffer, pointer >>> 0, length).slice();
      return { key, width, height, pixels: read(pixels, width * height * 4), params: Array.from(read(params, 11)) };
    }));
    if (skies.size > KEPT) skies.delete(skies.keys().next().value);
  }
  return skies.get(key);
}
