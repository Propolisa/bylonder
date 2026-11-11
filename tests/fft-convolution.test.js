// The compositor replay's FFT convolution (runtime/fft-convolution.js), Glare's Fog Glow on the GPU: its kernel's
// spectrum, inverted, is the kernel over its normalization at each displacement, summed over a block's texels where
// a wide kernel convolves blocks; and its domain holds every displacement within the image without wrapping.
import assert from 'node:assert/strict';
import { convolutionLayout, kernelSpectrum, MAX_KERNEL } from '../src/io_scene_babylon/runtime/fft-convolution.js';
import { fogGlowFieldOfView, fogGlowKernelValue, fogGlowNormalization } from '../src/compositor/fog-glow.js';

// The inverse transform of a real spectrum at a displacement (dx, dy), directly.
const inverse = (spectrum, [w, h], dx, dy) => {
  let sum = 0;
  for (let v = 0; v < h; v++) for (let u = 0; u < w; u++) sum += spectrum[v * w + u] * Math.cos(2 * Math.PI * (u * dx / w + v * dy / h));
  return sum;
};
const size = [20, 12], fieldOfView = fogGlowFieldOfView(0.85), degrees = fieldOfView / Math.max(...size);
const normalization = fogGlowNormalization(size, fieldOfView);
const layout = convolutionLayout(size);
assert.deepEqual(layout, { factor: 1, small: [20, 12], domain: [64, 32] }, 'a domain of powers of two holding twice the image');
const spectrum = kernelSpectrum(layout, (x, y) => fogGlowKernelValue(x, y, degrees), normalization);
for (const [dx, dy] of [[0, 0], [1, 0], [3, -2], [-19, 11]]) {
  const expected = fogGlowKernelValue(dx, dy, degrees) / normalization;
  assert.ok(Math.abs(inverse(spectrum, layout.domain, dx, dy) - expected) <= 1e-5 * Math.abs(expected) + 1e-9, `the kernel at (${dx}, ${dy})`);
}

const wide = convolutionLayout([1280, 720]);
assert.deepEqual(wide, { factor: 4, small: [320, 180], domain: [1024, 512] }, `a kernel wider than ${MAX_KERNEL} texels convolves blocks`);
const bell = (x, y) => Math.exp(-(x * x + y * y) / 4);
const blocks = kernelSpectrum({ factor: 2, small: [8, 8], domain: [16, 16] }, bell, 1);
const block = (dx, dy) => [-0.5, 0.5].reduce((sum, i) => sum + [-0.5, 0.5].reduce((s, j) => s + bell(2 * dx + i, 2 * dy + j), 0), 0);
assert.ok(Math.abs(inverse(blocks, [16, 16], 1, 2) - block(1, 2)) < 1e-6, "a block's kernel sums the kernel over its texels");
console.log('FFT convolution: the kernel spectrum inverts to the kernel over its normalization, per texel or per block');
