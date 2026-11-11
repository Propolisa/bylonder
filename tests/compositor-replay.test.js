// Blender's GPU compositor replayed in a view composites as Blender's compositor: each case of
// tests/fixtures/blender-compositor-gpu.json (the multi-pass nodes, Blender's own GPU compositor on a synthetic image) is
// recorded in the module as Blender's GPU compositor runs the node (compositor-replay.js nodeRecording), and its plan is
// run in WebGL 2 (headless Chromium) as the view's frame graph task runs it: each pass of Blender's compute shader as a
// fragment pass writing a new version of its image. Cases Bylonder does not replay are listed, with why; every other is
// compared with Blender's result. The classification of Blender's imageStore calls the replay rests on is checked
// against tests/fixtures/compositor-image-stores.json (UPDATE=1 writes it), so a Blender update shows what changed.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import '../src/python/bpy_interface.js';
import { blenderMain } from '../src/bmesh/bmesh-wasm.js';
import { idStruct } from '../src/python/bpy_rna.js';
import { compute } from '../src/compositor/compositor-shaders.js';
import { formatChannels, imageStores, nodeRecording, resolveSource, uploadFloats } from '../src/compositor/compositor-replay.js';
import { declaration } from '../src/nodes/blender/declarations.js';
import { GL_ARGS } from './e2e/tools.mjs';

// How each compute shader of Blender's compositor writes its images (imageStores), by file.
const STORES = new URL('./fixtures/compositor-image-stores.json', import.meta.url);
const stores = Object.fromEntries(Object.keys(compute).filter((n) => n.startsWith('compositor_')).sort().map((name) => [name, imageStores(resolveSource(name))]));
if (process.env.UPDATE) writeFileSync(STORES, JSON.stringify(stores, null, 1) + '\n');
assert.deepEqual(stores, JSON.parse(readFileSync(STORES, 'utf8')), "Blender's compute shaders write their images differently: check compositor-replay.js imageStores, then UPDATE=1");
const kinds = Object.values(stores).map(({ stores: s, shares }) => (shares ? 'shared' : Object.values(s).flat().every((k) => k === 'texel') ? 'texel' : Object.values(s).flat().every((k) => k === 'texel' || k === 'transposed') ? 'transposed' : 'other'));
console.log(`compositor-replay: ${kinds.filter((k) => k === 'texel' || k === 'transposed').length} of ${kinds.length} compute shaders replay as fragment passes`);

let chromium;
try { ({ chromium } = createRequire(import.meta.url)('playwright')); } catch {
  console.log('compositor-replay: skipped, Playwright is not installed');
  process.exit(0);
}

const { width, height, cases } = JSON.parse(readFileSync(new URL('./fixtures/blender-compositor-gpu.json', import.meta.url)));
// compositor-cpu-wasm.test.js's images: blender-reference/compositor-fixtures.py pixel and large_pixel.
const SPOTS = ['12,10', '30,20', '40,6'];
const image = Array.from({ length: width * height }, (_, i) => [i % width, Math.floor(i / width)]).flatMap(([x, y]) =>
  (SPOTS.includes(`${x},${y}`) ? [8, 6, 4, 1] : [x / width, y / height, 0.5 + 0.25 * ((x + y) % 2), 1]));
// The means of the quadrants Kuwahara Classic could pick at a pixel: those whose variance is the least to within float32
// rounding (its variance is E[x^2] - E[x]^2), where a GPU and Blender may pick differently and both are right.
function kuwaharaChoices(x, y, radius) {
  const quadrants = [0, 1, 2, 3].map((q) => {
    const sx = (q % 2) * 2 - 1, sy = Math.floor(q / 2) * 2 - 1, sum = [0, 0, 0, 0], squares = [0, 0, 0, 0];
    let count = 0;
    for (let j = 0; j <= radius; j++) for (let i = 0; i <= radius; i++) {
      const X = x + i * sx, Y = y + j * sy;
      if (X < 0 || Y < 0 || X >= width || Y >= height) continue;
      count++;
      for (let c = 0; c < 4; c++) { const v = image[(Y * width + X) * 4 + c]; sum[c] += v; squares[c] += v * v; }
    }
    const mean = sum.map((s) => s / count);
    return { mean, variance: [0, 1, 2].reduce((v, c) => v + squares[c] / count - mean[c] ** 2, 0) };
  });
  const least = Math.min(...quadrants.map((q) => q.variance));
  return quadrants.filter((q) => q.variance - least < 1e-4).map((q) => q.mean);
}
const large = ([w, h]) => Array.from({ length: w * h }, (_, i) => [i % w, Math.floor(i / w)]).flatMap(([x, y]) =>
  (Math.abs(x - 160) < 10 && Math.abs(y - 90) < 10 ? [8, 6, 4, 1] : [0.02, 0.02, 0.02, 1]));

// The fixtures' precision (compositor-fixtures.py).
idStruct(blenderMain().scene).render.compositor_precision = 'FULL';
const runs = cases.map(({ node, inputs, size }) => {
  const decl = declaration('compositor', node), imageInput = decl.inputs.find((s) => s.type === 'RGBA');
  const output = decl.outputs.find((s) => s.type === 'RGBA') ?? decl.outputs[0];
  const [w, h] = size ?? [width, height];
  const { plan, data } = nodeRecording(node, { values: inputs, linked: imageInput ? [imageInput.identifier] : [] }, w, h);
  if (plan.reasons) return { reasons: plan.reasons };
  // A step the page runs as an operation of its own (Fog Glow's convolution, fft-convolution.js) is not a pass to replay.
  const operation = plan.steps.find((s) => !['update', 'clear', 'copy', 'pass'].includes(s.op));
  if (operation) return { reasons: [`its ${operation.op} step is an operation of the replay, tested by fft-convolution.test.js`] };
  // Upload steps as RGBA floats, as the task makes them.
  const textures = new Map(plan.textures.map((t) => [t.id, t]));
  const steps = plan.steps.map((s) => (s.op === 'update' ? { ...s, floats: [...uploadFloats(data.subarray(s.data, s.data + s.bytes), s.format, s.extent, formatChannels(textures.get(s.texture).format))] } : s));
  return { plan: { ...plan, steps }, output: output.identifier, image: imageInput && (size ? large(size) : image), size: [w, h] };
});

// The task's replay (compositor-replay.js BlenderReplayTask record) in plain WebGL 2: a new version of a texture per
// write, uploads as float textures, a texture never written before read as zeros. Returns the output image's pixels.
function replay(runs) {
  const canvas = document.createElement('canvas'), gl = canvas.getContext('webgl2');
  gl.getExtension('EXT_color_buffer_float');
  gl.getExtension('OES_texture_float_linear');
  const compile = (type, source) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, source);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(s), line = Number(/ERROR: \d+:(\d+)/.exec(log)?.[1]);
      throw Error(`${log.split('\n')[0]} in: ${source.split('\n')[line - 1]?.trim()}`);
    }
    return s;
  };
  const vertex = compile(gl.VERTEX_SHADER, '#version 300 es\nvoid main() { vec2 p = vec2(float((gl_VertexID & 1) * 4 - 1), float((gl_VertexID & 2) * 2 - 1)); gl_Position = vec4(p, 0.0, 1.0); }');
  const programs = new Map();
  const program = (code) => {
    if (!programs.has(code)) {
      const p = gl.createProgram();
      gl.attachShader(p, vertex);
      // Babylon's GLSL 100 style as GLSL ES 3, as Babylon's shader processor makes it.
      gl.attachShader(p, compile(gl.FRAGMENT_SHADER, '#version 300 es\nprecision highp float;\nout vec4 bl_fragment;\n' + code.replace(/\bgl_FragColor\b/g, 'bl_fragment').replace(/\btexture2D\b/g, 'texture')));
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(p));
      programs.set(code, p);
    }
    return programs.get(code);
  };
  const texture = (w, h, pixels = null) => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, h, 0, gl.RGBA, gl.FLOAT, pixels && new Float32Array(pixels));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    return Object.assign(t, { w, h });
  };
  const target = (t) => {
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    gl.viewport(0, 0, t.w, t.h);
    return fbo;
  };
  const EXTEND = { extend: gl.CLAMP_TO_EDGE, repeat: gl.REPEAT, mirrored_repeat: gl.MIRRORED_REPEAT, clamp_to_border: gl.CLAMP_TO_EDGE };
  return runs.map(({ plan, output, image, size }) => { try {
    if (!plan) return null;
    const specs = new Map(plan.textures.map((t) => [t.id, t])), current = new Map();
    for (const [, id] of Object.entries(plan.inputs)) current.set(id, texture(size[0], size[1], image));
    const uploads = new Map();
    for (const s of plan.steps.filter((s) => s.op === 'update')) {
      const [w, h] = specs.get(s.texture).size, pixels = uploads.get(s.texture) ?? new Float32Array(w * h * 4);
      for (let y = 0; y < Math.max(1, s.extent[1]); y++) pixels.set(s.floats.slice(y * s.extent[0] * 4, (y + 1) * s.extent[0] * 4), ((s.offset[1] + y) * w + s.offset[0]) * 4);
      uploads.set(s.texture, pixels);
    }
    for (const [id, pixels] of uploads) current.set(id, texture(specs.get(id).size[0], specs.get(id).size[1], pixels));
    const version = (id) => texture(specs.get(id).size[0], specs.get(id).size[1]);
    const read = (id) => { if (!current.has(id)) current.set(id, version(id)); return current.get(id); };
    for (const step of plan.steps) {
      if (step.op === 'update') continue;
      const id = step.op === 'clear' ? step.texture : step.op === 'copy' ? step.to : step.target, out = version(id);
      if (step.op === 'clear') {
        target(out);
        gl.clearBufferfv(gl.COLOR, 0, step.value);
      } else if (step.op === 'copy') {
        const from = target(read(step.from)), to = target(out);
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, from);
        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, to);
        gl.blitFramebuffer(0, 0, out.w, out.h, 0, 0, out.w, out.h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      } else {
        const p = program(step.code);
        target(out);
        gl.useProgram(p);
        gl.uniform3iv(gl.getUniformLocation(p, 'bl_domain'), step.domain);
        for (const c of step.pushConstants) {
          const at = gl.getUniformLocation(p, c.array > 0 ? c.name + '[0]' : c.name), v = [c.value ?? 0].flat(), n = { 2: 2, 3: 3, 4: 4 }[c.type.at(-1)] ?? 1;
          if (c.type === 'float4x4') gl.uniformMatrix4fv(at, false, v);
          else if (/^(int|uint|bool)/.test(c.type)) gl[`uniform${n}iv`](at, v);
          else gl[`uniform${n}fv`](at, v);
        }
        [...step.samplers.map((s) => ({ ...s, t: read(s.texture) })), ...step.before.map((b) => ({ ...b, t: read(b.texture) }))].forEach((s, unit) => {
          gl.activeTexture(gl.TEXTURE0 + unit);
          gl.bindTexture(gl.TEXTURE_2D, s.t);
          const filter = s.linear ? gl.LINEAR : gl.NEAREST;
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
          if (s.extend) { gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, EXTEND[s.extend[0]]); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, EXTEND[s.extend[1]]); }
          gl.uniform1i(gl.getUniformLocation(p, s.name), unit);
        });
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      current.set(id, out);
    }
    const result = plan.outputs[output];
    if (!result?.texture && result?.texture !== 0) {
      const v = result?.value ?? [0, 0, 0, 0];
      return { pixels: Array.from({ length: size[0] * size[1] }, () => v).flat() };
    }
    const t = read(result.texture), pixels = new Float32Array(t.w * t.h * 4);
    target(t);
    gl.readPixels(0, 0, t.w, t.h, gl.RGBA, gl.FLOAT, pixels);
    return { pixels: [...pixels], channels: specs.get(result.texture).format };
  } catch (error) { return { error: error.message }; } });
}

const browser = await chromium.launch({ args: GL_ARGS });
try {
  const page = await browser.newPage();
  const results = await page.evaluate(replay, runs);
  const failures = [], replayed = [];
  cases.forEach(({ node, inputs, result, size, probes }, i) => {
    const label = `${node} ${inputs.Type ?? ''}`.trim();
    if (runs[i].reasons) { console.log(`  ${label}: not replayed (${runs[i].reasons.join('; ')})`); return; }
    if (results[i].error) { failures.push(`${label}: ${results[i].error}`); return; }
    // A float image (a mask) as the Group Output's color, as Blender converts it.
    const channels = formatChannels(results[i].channels ?? 'RGBA'), w = (size ?? [width])[0];
    const texel = (x, y) => { const at = (y * w + x) * 4, px = results[i].pixels.slice(at, at + 4); return channels === 1 ? [px[0], px[0], px[0], 1] : px; };
    const got = size ? probes.flatMap(([x, y]) => texel(x, y)) : Array.from({ length: width * height }, (_, k) => {
      const x = k % width, y = Math.floor(k / width), px = texel(x, y), blender = result.slice(k * 4, k * 4 + 4);
      const close = (a) => a.every((v, c) => Math.abs(v - px[c]) < 2e-2);
      // A tie Kuwahara Classic broke otherwise than Blender, with Blender's pick among the tied: Blender's value.
      if (label === 'CompositorNodeKuwahara Classic' && !close(blender)) {
        const choices = kuwaharaChoices(x, y, inputs.Size);
        if (choices.some(close) && choices.some((m) => m.every((v, c) => Math.abs(v - blender[c]) < 2e-2))) return blender;
      }
      return px;
    }).flat();
    // Blender's GPU filters textures in hardware, with coarse weights; the replay's border sampling (WebGL 2 has no
    // clamp to border) filters exactly, as Blender's CPU path: Lens Distortion differs by up to 1% beside bright spots.
    const worst = result.reduce((m, v, k) => Math.max(m, Math.abs(v - got[k]) / Math.max(1, Math.abs(v))), 0);
    if (!(worst < 2e-2)) failures.push(`${label} ${JSON.stringify(inputs)}: off by ${worst}`);
    else replayed.push(label);
  });
  assert.deepEqual(failures, [], `replays differ from Blender:\n${failures.join('\n')}`);
  console.log(`compositor-replay: ${replayed.length} of ${cases.length} multi-pass nodes replay as Blender's compositor (${replayed.join(', ')})`);
} finally {
  await browser.close();
}
