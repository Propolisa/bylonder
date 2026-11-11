// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// A convolution by FFT in WebGL 2 passes, as a step of the compositor's replay (blocks.js ReplayTask): the replay's
// `fogGlow` step (compositor-replay.js), Glare's Fog Glow, which Blender convolves by an FFT on the CPU. A kernel wider
// than MAX_KERNEL texels convolves the image averaged over blocks of 2, 4, ... texels, with the kernel summed over each
// block, and takes the result back to the image's size bilinearly. The kernel is the caller's (a function of the
// displacement in texels), as is its normalization.
import { Constants, EffectWrapper, RawTexture } from '@babylonjs/core';

// The widest kernel, in texels, convolved at the image's own resolution.
export const MAX_KERNEL = 512;

/** @param {number} n */
const nextPow2 = (n) => 2 ** Math.ceil(Math.log2(Math.max(n, 2)));
/**
 * The reduction and FFT domain of an image of `size`: blocks of `factor` texels, `small` blocks, `domain` texels.
 * @param {number[]} size
 * @typedef {{ factor: number, small: number[], domain: number[] }} Layout
 * @returns {Layout}
 */
export function convolutionLayout([width, height]) {
  let factor = 1;
  while (Math.max(width, height) / factor > MAX_KERNEL) factor *= 2;
  const small = [Math.ceil(width / factor), Math.ceil(height / factor)];
  return { factor, small, domain: small.map((n) => nextPow2(2 * n - 1)) };
}

/**
 * In place radix-2 FFT of `n` complex values at `re`, `im` (offset, stride), forward.
 * @param {Float64Array} re @param {Float64Array} im @param {number} offset @param {number} stride @param {number} n
 */
function fft(re, im, offset, stride, n) {
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const a = offset + i * stride, b = offset + j * stride;
      [re[a], re[b]] = [re[b], re[a]];
      [im[a], im[b]] = [im[b], im[a]];
    }
  }
  for (let len = 2; len <= n; len *= 2) {
    const angle = (-2 * Math.PI) / len;
    for (let start = 0; start < n; start += len) {
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(angle * k), wi = Math.sin(angle * k);
        const a = offset + (start + k) * stride, b = offset + (start + k + len / 2) * stride;
        const tr = re[b] * wr - im[b] * wi, ti = re[b] * wi + im[b] * wr;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
      }
    }
  }
}

/**
 * The kernel's spectrum on the FFT domain, real as the kernel is even, divided by the normalization and by the domain's
 * size (the inverse FFT's scale): each block's kernel, the kernel summed over the texels of a block of `factor`.
 * @param {Layout} layout @param {(x: number, y: number) => number} kernel @param {number} normalization
 */
export function kernelSpectrum({ factor, domain: [w, h] }, kernel, normalization) {
  const re = new Float64Array(w * h), im = new Float64Array(w * h), centre = (factor - 1) / 2;
  for (let y = 0; y < h; y++) {
    const dy = y < h / 2 ? y : y - h;
    for (let x = 0; x < w; x++) {
      const dx = x < w / 2 ? x : x - w;
      let sum = 0;
      for (let j = 0; j < factor; j++) for (let i = 0; i < factor; i++) sum += kernel(dx * factor + i - centre, dy * factor + j - centre);
      re[y * w + x] = sum;
    }
  }
  for (let y = 0; y < h; y++) fft(re, im, y * w, 1, w);
  for (let x = 0; x < w; x++) fft(re, im, x, w, h);
  const scale = 1 / (normalization * w * h);
  return Float32Array.from(re, (v) => v * scale);
}

const PACK = `precision highp float;
precision highp int;
uniform sampler2D source;
uniform ivec2 sourceSize;
uniform int factor;
void main(void) {
  ivec2 block = ivec2(gl_FragCoord.xy);
  vec3 sum = vec3(0.0);
  for (int j = 0; j < factor; j++) for (int i = 0; i < factor; i++) {
    ivec2 texel = block * factor + ivec2(i, j);
    if (all(lessThan(texel, sourceSize))) sum += texelFetch(source, texel, 0).rgb;
  }
  gl_FragColor = vec4(sum / float(factor * factor), 0.0);
}`;
// A Stockham radix-2 stage along one axis of two complex signals per texel (xy, zw), in natural order once all ran.
const STAGE = `precision highp float;
precision highp int;
uniform sampler2D source;
uniform int horizontal;
uniform int n;
uniform int span;
uniform float direction;
vec2 cmul(vec2 a, vec2 b) { return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }
void main(void) {
  ivec2 p = ivec2(gl_FragCoord.xy), a = p, b = p;
  int i = horizontal == 1 ? p.x : p.y, k = i % (2 * span), part = k % span, j = (i / (2 * span)) * span + part;
  if (horizontal == 1) { a.x = j; b.x = j + n / 2; } else { a.y = j; b.y = j + n / 2; }
  vec4 v0 = texelFetch(source, a, 0), v1 = texelFetch(source, b, 0);
  float angle = direction * 3.14159265358979 * float(part) / float(span);
  vec2 w = vec2(cos(angle), sin(angle));
  vec4 t = vec4(cmul(v1.xy, w), cmul(v1.zw, w));
  gl_FragColor = k < span ? v0 + t : v0 - t;
}`;
const MULTIPLY = `precision highp float;
uniform sampler2D source;
uniform sampler2D spectrum;
void main(void) {
  ivec2 p = ivec2(gl_FragCoord.xy);
  gl_FragColor = texelFetch(source, p, 0) * texelFetch(spectrum, p, 0).r;
}`;
// The glow at a texel of the highlights: the blocks' convolution bilinearly between block centres, the highlights' alpha.
const UNPACK = `precision highp float;
precision highp int;
uniform sampler2D source;
uniform sampler2D highlights;
uniform int factor;
vec3 glow(ivec2 block) { vec4 c = texelFetch(source, max(block, ivec2(0)), 0); return vec3(c.x, c.y, c.z); }
void main(void) {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec2 at = (vec2(p) + 0.5) / float(factor) - 0.5;
  ivec2 corner = ivec2(floor(at));
  vec2 f = at - vec2(corner);
  vec3 rgb = mix(mix(glow(corner), glow(corner + ivec2(1, 0)), f.x), mix(glow(corner + ivec2(0, 1)), glow(corner + ivec2(1, 1)), f.x), f.y);
  gl_FragColor = vec4(rgb, texelFetch(highlights, p, 0).a);
}`;

/** @param {number} type */
const options = (type) => ({ createMipMaps: false, types: [type], formats: [Constants.TEXTUREFORMAT_RGBA], samples: 1, useSRGBBuffers: [false] });
// The FFT's images in full floats (its sums overflow half floats), the glow in half floats as Blender's RGBA16F result.
const FLOAT = options(Constants.TEXTURETYPE_FLOAT), HALF = options(Constants.TEXTURETYPE_HALF_FLOAT);
/** @type {WeakMap<object, Map<string, EffectWrapper>>} */
const effects = new WeakMap();
/** Each kernel's spectra by domain and step. @type {WeakMap<Function, Map<string, RawTexture>>} */
const spectra = new WeakMap();

/**
 * A replay step convolving the RGB of `step.source` (an image of `step.size`) with `kernel(x, y, degreesPerTexel)` over
 * `step.normalization`, into a new version of `step.target` with the source's alpha, as Blender's execute_fog_glow
 * writes its glow; the kernel's angle per texel is `step.fieldOfView` over the image's larger side. `task` is the
 * replay task (blocks.js ReplayTask), `read(id)` a recorded texture's current handle. Gives the target's handle.
 * @param {any} task
 * @param {{ source: number, target: number, size: number[], fieldOfView: number, normalization: number }} step
 * @param {(id: number) => number} read
 * @param {(x: number, y: number, degreesPerTexel: number) => number} kernel
 * @returns {number}
 */
export function fftConvolution(task, step, read, kernel) {
  /** @type {import('@babylonjs/core').FrameGraph} */
  const frameGraph = task._frameGraph, engine = frameGraph.engine, manager = frameGraph.textureManager;
  const layout = convolutionLayout(step.size), [w, h] = layout.domain, name = `${task.name} convolution`;
  const own = effects.get(engine) ?? new Map();
  effects.set(engine, own);
  /** @param {string} key @param {string} code @param {string[]} uniforms @param {string[]} samplers */
  const effect = (key, code, uniforms, samplers) => {
    if (!own.has(key)) own.set(key, new EffectWrapper({ name: `FFT convolution ${key}`, engine, fragmentShader: task.shaderCode(code), useAsPostProcess: true, uniforms, samplers }));
    return /** @type {EffectWrapper} */ (own.get(key));
  };
  const kernelSpectra = spectra.get(kernel) ?? new Map(), key = [w, h, layout.factor, step.fieldOfView, step.normalization, step.size].join();
  spectra.set(kernel, kernelSpectra);
  if (!kernelSpectra.has(key)) {
    const degrees = step.fieldOfView / Math.max(...step.size);
    const values = kernelSpectrum(layout, (x, y) => kernel(x, y, degrees), step.normalization);
    kernelSpectra.set(key, RawTexture.CreateRTexture(values, w, h, frameGraph.scene, false, false, Constants.TEXTURE_NEAREST_SAMPLINGMODE, Constants.TEXTURETYPE_FLOAT));
  }
  const spectrum = manager.importTexture(`${name} spectrum`, /** @type {any} */ (kernelSpectra.get(key)?.getInternalTexture()));
  let passes = 0;
  /** @param {{ width: number, height: number }} size @param {any} type */
  const texture = (size, type) => manager.createRenderTargetTexture(`${name} ${passes}`, { size, sizeIsPercentage: false, isHistoryTexture: false, options: type });
  // The FFT's two images, each pass drawing into the one it does not read.
  const images = [texture({ width: w, height: h }, FLOAT), texture({ width: w, height: h }, FLOAT)];
  /**
   * A pass drawing `wrapper` into `target`, its uniforms set by `bind`; its inputs are read texel by texel (a float
   * texture filtered linearly is incomplete without OES_texture_float_linear).
   * @param {EffectWrapper} wrapper @param {Record<string, number>} inputs @param {(effect: import('@babylonjs/core').Effect) => void} bind
   * @param {number} target
   */
  const draw = (wrapper, inputs, bind, target = images[Number(Object.values(inputs).includes(images[0]))]) => {
    const pass = frameGraph.addRenderPass(`${name} ${passes++}`);
    pass.setRenderTarget(target);
    pass.addDependencies(Object.values(inputs));
    pass.setExecuteFunc((context) => {
      for (const handle of Object.values(inputs)) context.setTextureSamplingMode(handle, Constants.TEXTURE_NEAREST_SAMPLINGMODE);
      context.applyFullScreenEffect(wrapper.drawWrapper, () => {
        const fx = /** @type {import('@babylonjs/core').Effect} */ (wrapper.drawWrapper.effect);
        bind(fx);
        for (const [sampler, handle] of Object.entries(inputs)) context.bindTextureHandle(fx, sampler, handle);
      });
    });
    return target;
  };
  const source = read(step.source);
  let image = draw(effect('pack', PACK, ['sourceSize', 'factor'], ['source']), { source }, (fx) => {
    fx.setInt2('sourceSize', step.size[0], step.size[1]);
    fx.setInt('factor', layout.factor);
  });
  const stage = effect('stage', STAGE, ['horizontal', 'n', 'span', 'direction'], ['source']);
  /** @param {number} direction -1 forward, 1 inverse */
  const transform = (direction) => {
    for (const [horizontal, n] of [[1, w], [0, h]]) for (let span = 1; span < n; span *= 2) {
      image = draw(stage, { source: image }, (fx) => {
        fx.setInt('horizontal', horizontal);
        fx.setInt('n', n);
        fx.setInt('span', span);
        fx.setFloat('direction', direction);
      });
    }
  };
  transform(-1);
  image = draw(effect('multiply', MULTIPLY, [], ['source', 'spectrum']), { source: image, spectrum }, () => {});
  transform(1);
  return draw(effect('unpack', UNPACK, ['factor'], ['source', 'highlights']), { source: image, highlights: source }, (fx) => fx.setInt('factor', layout.factor),
    texture({ width: step.size[0], height: step.size[1] }, HALF));
}
