// Open Image Denoise, as Blender's Denoise node runs it (its RT filter on HDR light, guided by albedo and normals), on
// WebGPU: oidn-web runs OIDN's own network with OIDN's trained weights (oidn/rt_hdr_alb_nrm.tza, 1.8 MB), both fetched
// the first time something is denoised. Without WebGPU there is no denoiser (null).
import { read } from '../port/wasm.js';

const WEIGHTS = new URL('./oidn/rt_hdr_alb_nrm.tza', import.meta.url);

let loading = null;
const network = () => (loading ??= (async () => {
  if (!globalThis.navigator?.gpu || !(await navigator.gpu.requestAdapter())) return null;
  const [{ initUNetFromBuffer }, weights] = await Promise.all([import('oidn-web'), read(WEIGHTS)]);
  return initUNetFromBuffer(weights instanceof ArrayBuffer ? weights : Uint8Array.from(weights).buffer, undefined, { aux: true, hdr: true });
})());

// RGB floats as RGBA, and 0..1 RGB floats as 8-bit RGBA, as oidn-web takes its colour and its guides.
const rgba = (rgb, count) => {
  const out = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) out.set(rgb.subarray(i * 3, i * 3 + 3), i * 4);
  return out;
};
const bytes = (rgb, count) => {
  const out = new Uint8ClampedArray(count * 4);
  for (let i = 0; i < count; i++) for (let c = 0; c < 4; c++) out[i * 4 + c] = c < 3 ? rgb[i * 3 + c] * 255 + 0.5 : 255;
  return out;
};

/**
 * Light (`size` x `size` RGB floats) denoised, guided by its albedo and normals (RGB, 0..1, normals encoded as n / 2 +
 * 0.5): RGB floats, or null where there is no denoiser.
 */
export async function denoise(light, albedo, normal, size) {
  const unet = await network().catch(() => null);
  if (!unet) return null;
  const count = size * size, image = (data) => ({ data, width: size, height: size });
  const result = await new Promise((done, error) => unet.tileExecute({
    color: image(rgba(light, count)), albedo: image(bytes(albedo, count)), normal: image(bytes(normal, count)), done, error,
  }));
  const out = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) out.set(result.data.subarray(i * 4, i * 4 + 3), i * 3);
  return out;
}
