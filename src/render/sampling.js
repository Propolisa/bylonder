// Offline samples. Each output frame averages N renders. Every sample shifts the camera projection by a
// sub-pixel offset (anti-aliasing) and, with motion blur on, moves time across the shutter interval
// (true sub-frame motion blur, as in Blender's render, instead of the viewport's post-process approximation).

// Low-discrepancy sequence used for jitter offsets (Halton base 2 and 3), centered on the pixel.
export function halton(index, base) {
  let f = 1, r = 0;
  for (let i = index; i > 0; i = Math.floor(i / base)) { f /= base; r += f * (i % base); }
  return r;
}
export const jitter = (sample, samples) => (samples <= 1 ? [0, 0] : [halton(sample + 1, 2) - 0.5, halton(sample + 1, 3) - 0.5]);

// Scene frame for each sample. Blender centers the shutter on the frame; the shutter is in frames and is
// limited to 1 so consecutive frames never overlap in time.
export function sampleTimes(frame, samples, { motionBlur = false, shutter = 0.5 } = {}) {
  const s = Math.min(1, Math.max(0, shutter));
  return Array.from({ length: samples }, (_, i) => (motionBlur && samples > 1 ? frame + s * ((i + 0.5) / samples - 0.5) : frame));
}

// Adds a pixel offset to a Babylon projection matrix (row-major m[]), in place. Perspective projections
// carry the offset in the z row, scaled by m[11] (+1 left-handed, -1 right-handed), so it survives the
// perspective divide; orthographic ones carry it in translation.
export function jitterProjection(m, [dx, dy], width, height, orthographic = false) {
  const x = (2 * dx) / width, y = (2 * dy) / height;
  if (orthographic) { m[12] += x; m[13] += y; } else { m[8] += x * m[11]; m[9] += y * m[11]; }
  return m;
}

// Averages RGBA8 frames in floating point, so many samples do not band.
export function createAccumulator(width, height) {
  const sum = new Float32Array(width * height * 4);
  let count = 0;
  return {
    get count() { return count; },
    add(rgba) { for (let i = 0; i < sum.length; i++) sum[i] += rgba[i]; count++; },
    result(out = new Uint8ClampedArray(sum.length)) { const k = 1 / Math.max(1, count); for (let i = 0; i < sum.length; i++) out[i] = sum[i] * k + 0.5; return out; },
    reset() { sum.fill(0); count = 0; },
  };
}
