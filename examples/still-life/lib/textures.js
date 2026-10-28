// Procedural textures computed in code: tileable value noise, and textures filled pixel by pixel from a function of
// (u, v). Nothing is downloaded, and the same code gives the same pixels everywhere.

const hash = (x, y, seed) => {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const smooth = (t) => t * t * (3 - 2 * t);
const mod = (a, n) => ((a % n) + n) % n;

// Value noise in [0, 1] that repeats every `period` cells.
export function noise(x, y, period = 256, seed = 0) {
  const xi = Math.floor(x), yi = Math.floor(y), fx = smooth(x - xi), fy = smooth(y - yi);
  const at = (i, j) => hash(mod(xi + i, period), mod(yi + j, period), seed);
  const top = at(0, 0) + (at(1, 0) - at(0, 0)) * fx, bottom = at(0, 1) + (at(1, 1) - at(0, 1)) * fx;
  return top + (bottom - top) * fy;
}

// Fractal noise of `octaves` layers, tileable over the unit square at the base frequency `scale`.
export function fbm(u, v, { scale = 4, octaves = 5, seed = 0 } = {}) {
  let sum = 0, amplitude = 0.5, total = 0;
  for (let o = 0, f = scale; o < octaves; o++, f *= 2, amplitude *= 0.5) {
    sum += amplitude * noise(u * f, v * f, f, seed + o * 17);
    total += amplitude;
  }
  return sum / total;
}

export const mix = (a, b, t) => a.map((x, i) => x + (b[i] - x) * t);
export const clamp01 = (t) => Math.min(1, Math.max(0, t));

// An RGBA texture of size x size pixels; color(u, v) returns [r, g, b] in 0..1.
export function texture(scene, name, size, color, { srgb = true } = {}) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const c = color(x / size, y / size), i = (y * size + x) * 4;
    data[i] = c[0] * 255; data[i + 1] = c[1] * 255; data[i + 2] = c[2] * 255; data[i + 3] = 255;
  }
  const result = BABYLON.RawTexture.CreateRGBATexture(data, size, size, scene, true, false, BABYLON.Texture.TRILINEAR_SAMPLINGMODE);
  result.name = name;
  result.gammaSpace = srgb;
  result.anisotropicFilteringLevel = 8;
  return result;
}

// A tangent-space normal map from a height function, with heights in 0..1 scaled by `strength`.
export function normalMap(scene, name, size, height, strength = 1) {
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) h[y * size + x] = height(x / size, y / size);
  const at = (x, y) => h[mod(y, size) * size + mod(x, size)];
  return texture(scene, name, size, (u, v) => {
    const x = Math.round(u * size), y = Math.round(v * size);
    const dx = (at(x + 1, y) - at(x - 1, y)) * strength, dy = (at(x, y + 1) - at(x, y - 1)) * strength;
    const length = Math.hypot(dx, dy, 1);
    return [0.5 - dx / length / 2, 0.5 + dy / length / 2, 0.5 + 0.5 / length];
  }, { srgb: false });
}
