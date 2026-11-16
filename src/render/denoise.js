// Open Image Denoise, as Blender's Denoise node runs it (its RT filter on HDR light, guided by albedo and normals), on
// WebGPU: oidn-web runs OIDN's own network with OIDN's trained weights (oidn/rt_hdr_alb_nrm.tza, 1.8 MB), both fetched
// the first time something is denoised. Without WebGPU there is no denoiser (null).
import { read } from '../port/wasm.js';

const WEIGHTS = new URL('./oidn/rt_hdr_alb_nrm.tza', import.meta.url);

let loading = null;
const network = () => (loading ??= (async () => {
  const adapter = await globalThis.navigator?.gpu?.requestAdapter();
  if (!adapter) return null;
  const device = await adapter.requestDevice({ requiredFeatures: adapter.features.has('shader-f16') ? ['shader-f16'] : [] });
  const [{ initUNetFromBuffer }, weights] = await Promise.all([import('oidn-web'), read(WEIGHTS)]);
  const unet = await initUNetFromBuffer(weights instanceof ArrayBuffer ? weights : Uint8Array.from(weights).buffer, { device }, { aux: true, hdr: true });
  return { unet, device };
})());

const luminance = (rgb, i) => 0.212671 * rgb[i * 3] + 0.71516 * rgb[i * 3 + 1] + 0.072169 * rgb[i * 3 + 2];

// The exposure OIDN gives HDR input (its autoexposure, as Blender's Denoise node gets it): its key over the log-average
// luminance of 16 px bins, near-black bins left out; here over the texels baked into (`baked(i)`), as the rest of a
// lightmap is empty.
function exposure(light, size, baked) {
  const BIN = 16;
  let sum = 0, bins = 0;
  for (let by = 0; by < size; by += BIN) {
    for (let bx = 0; bx < size; bx += BIN) {
      let total = 0, count = 0;
      for (let y = by; y < Math.min(by + BIN, size); y++) {
        for (let x = bx; x < Math.min(bx + BIN, size); x++) if (baked(y * size + x)) { total += luminance(light, y * size + x); count++; }
      }
      if (count && total / count > 1e-8) { sum += Math.log2(total / count); bins++; }
    }
  }
  return bins ? 0.18 / 2 ** (sum / bins) : 1;
}

/**
 * Light (`size` x `size` RGB floats) denoised, guided by its albedo and normals (RGB, 0..1, normals encoded as n / 2 +
 * 0.5, zero where nothing was baked): RGB floats, or null where there is no denoiser.
 */
export async function denoise(light, albedo, normal, size) {
  const oidn = await network().catch(() => null);
  if (!oidn) return null;
  const { unet, device } = oidn, count = size * size;
  const baked = (i) => normal[i * 3] || normal[i * 3 + 1] || normal[i * 3 + 2];
  // The exposure given as the input's scale, which oidn-web leaves at 1 for buffers it is handed.
  const scale = exposure(light, size, baked);
  const buffer = (rgb, factor = 1) => {
    const data = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) data.set([rgb[i * 3] * factor, rgb[i * 3 + 1] * factor, rgb[i * 3 + 2] * factor, 1], i * 4);
    const made = device.createBuffer({ size: data.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC });
    device.queue.writeBuffer(made, 0, data);
    return { data: made, width: size, height: size };
  };
  const inputs = [buffer(light, scale), buffer(albedo), buffer(normal)];
  try {
    const result = await new Promise((done, error) => unet.tileExecute({ color: inputs[0], albedo: inputs[1], normal: inputs[2], done, error }));
    const staging = device.createBuffer({ size: count * 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const encoder = device.createCommandEncoder();
    encoder.copyBufferToBuffer(result.data, 0, staging, 0, count * 16);
    device.queue.submit([encoder.finish()]);
    await staging.mapAsync(GPUMapMode.READ);
    const rgba = new Float32Array(staging.getMappedRange()), out = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) for (let c = 0; c < 3; c++) out[i * 3 + c] = rgba[i * 4 + c] / scale;
    staging.destroy();
    return out;
  } finally {
    for (const input of inputs) input.data.destroy();
  }
}
