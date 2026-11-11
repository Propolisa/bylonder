// SPDX-License-Identifier: GPL-2.0-or-later
// Glare's Fog Glow kernel as Blender's compositor makes it, for the replay of Blender's GPU compositor, which reads Fog
// Glow's highlights back to convolve them with the kernel by an FFT on the CPU: the replay convolves them on the GPU
// (runtime/fft-convolution.js) with this kernel, which an exported page ships as bylonder-fog-glow/fog-glow.js, the
// unit block:fog_glow.

// blender-port: node_composite_glare.cc compute_fog_glow_field_of_view, in degrees, for Glare's Size.
export const fogGlowFieldOfView = (size) => {
  const t = Math.cbrt(Math.min(Math.max(size, 0), 1));
  return 180 * (1 - t) + 10 * t;
};

// blender-port: fog_glow_kernel.cc compute_fog_glow_kernel_value, at a displacement of (x, y) texels.
export function fogGlowKernelValue(x, y, degreesPerTexel) {
  const theta = Math.hypot(x, y) * degreesPerTexel;
  const f0 = 2.61e6 * Math.exp(-((theta / 0.02) ** 2));
  const f1 = 20.91 / (theta + 0.02) ** 3;
  const f2 = 72.37 / (theta + 0.02) ** 2;
  return 0.384 * f0 + 0.478 * f1 + 0.138 * f2;
}

// blender-port: fftw.cc find_next_even_humble_number.
const humble = (n) => { for (const p of [2, 3, 5, 7]) while (n > 1 && n % p === 0) n /= p; return n <= 1; };
const evenHumble = (n) => { for (n += n % 2; !humble(n); n += 2); return n; };

// blender-port: node_composite_glare.cc execute_fog_glow and fog_glow_kernel.cc FogGlowKernel: the sum of the kernel
// over the zero padded FFT domain Blender transforms the highlights of `size` in, which normalizes the glow.
export function fogGlowNormalization([width, height], fieldOfView) {
  const kernelSize = Math.max(width, height), degrees = fieldOfView / kernelSize;
  const sx = evenHumble(width + kernelSize - 1), sy = evenHumble(height + kernelSize - 1);
  let sum = 0;
  for (let y = 0; y < sy; y++) for (let x = 0; x < sx; x++) sum += fogGlowKernelValue(x - (sx >> 1), y - (sy >> 1), degrees);
  return sum;
}
