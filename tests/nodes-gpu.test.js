// Blender's nodes in Bylonder output what they output in Blender: each case of tests/fixtures/blender-nodes.json
// (Blender's GPU compositor, tools/blender-reference/node-fixtures.py) runs the node's steps on its constant inputs
// in WebGL 2 (headless Chromium) and reads the pixel back. Compositor nodes run their block's own fragment shader.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { NullEngine, Scene, FrameGraph } from '@babylonjs/core';
import { SHADER_NODES, STAND_INS } from '../src/nodes/blender/shader-nodes.js';
import { halfFloats } from '../src/blenkernel/colorband.js';
import { compositorNodeClasses } from '../src/nodes/blender/compositor-nodes.js';
import { declaration } from '../src/nodes/blender/declarations.js';
import { compileSteps, kindOfSocket, menuValue } from '../src/nodes/blender/node-code.js';
import { convert, glslValue, socketType } from '../src/nodes/blender/sockets.js';

let chromium;
try { ({ chromium } = createRequire(import.meta.url)('playwright')); } catch {
  console.log('nodes-gpu: skipped, Playwright is not installed');
  process.exit(0);
}

const { cases } = JSON.parse(readFileSync(new URL('./fixtures/blender-nodes.json', import.meta.url)));
const engine = new NullEngine(), scene = new Scene(engine), frameGraph = new FrameGraph(scene);

// A shader node's steps on constants, as a fragment shader writing the output socket.
function shaderProgram({ node, properties, inputs, output }) {
  const decl = declaration('shader', node), functions = new Map();
  const values = { ...Object.fromEntries(decl.inputs.map((s) => [s.identifier, s.default])), ...inputs };
  const links = new Map(decl.inputs.filter((s) => socketType(s.type)).map((s) => [s.identifier,
    s.type === 'MENU' ? menuValue(s, values[s.identifier]) : glslValue(values[s.identifier], socketType(s.type).kind)]));
  const p = { ...Object.fromEntries(Object.entries(decl.properties).map(([k, v]) => [k, v.default])), ...properties };
  // Generated coordinates, which an unlinked vector takes, are unused where an input is unlinked here (1D noise).
  links.set('$orco', 'vec3(0.0)');
  const textures = [];
  const steps = SHADER_NODES[node](p, decl, { connected: (id) => id in inputs, linked: (id) => id === output });
  const body = compileSteps(decl, steps, links, {
    emit: (k, c) => functions.set(k, c), free: (n) => n + '_' + functions.size + '_' + Math.random().toString(36).slice(2, 7),
    sampler: (table) => { const name = 'bl_table_' + textures.length; textures.push([name, Array.from(halfFloats(table))]); return name; },
    functions: STAND_INS,
  });
  const kind = kindOfSocket(decl, '@' + output);
  const samplers = textures.map(([name]) => `uniform sampler2D ${name};`);
  return { code: [...samplers, ...functions.values(), `void main(void) {\n${body}gl_FragColor = ${convert(links.get('@' + output), kind, 'color4')};\n}`].join('\n'), uniforms: [], textures };
}

// A compositor node's block with the case's values, its fragment shader and uniforms, reading the image's texel.
function compositorProgram({ node, properties, inputs }) {
  const block = new compositorNodeClasses[node]('Case', frameGraph, scene);
  Object.assign(block.properties, properties);
  Object.assign(block.values, inputs);
  const { code, uniforms } = block._fragment();
  return { code, image: block.values[block.image.identifier], uniforms: uniforms.map(([name, id, kind]) => [name, kind, block.values[id]]) };
}

const programs = cases.map((c) => (c.tree === 'shader' ? shaderProgram(c) : compositorProgram(c)));

function run(programs) {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2');
  gl.getExtension('EXT_color_buffer_float');
  const target = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, target);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 1, 1, 0, gl.RGBA, gl.FLOAT, null);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target, 0);
  const shader = (type, source) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, source);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(s) + '\n' + source);
    return s;
  };
  const vertex = shader(gl.VERTEX_SHADER, '#version 300 es\nout vec2 vUV;\nvoid main() { vec2 p = vec2(float((gl_VertexID & 1) * 4 - 1), float((gl_VertexID & 2) * 2 - 1)); vUV = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }');
  const image = gl.createTexture();
  return programs.map(({ code, uniforms, image: texel, textures = [] }) => {
    // Babylon's GLSL 100 style (varying, texture2D, gl_FragColor) as GLSL ES 3.
    const source = '#version 300 es\nprecision highp float;\nprecision highp int;\nprecision highp sampler2D;\nout vec4 fragColor;\n' +
      code.replace(/\bvarying\b/g, 'in').replace(/\btexture2D\b/g, 'texture').replace(/\bgl_FragColor\b/g, 'fragColor');
    const program = gl.createProgram();
    gl.attachShader(program, vertex);
    gl.attachShader(program, shader(gl.FRAGMENT_SHADER, source));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(program));
    gl.useProgram(program);
    for (const [name, kind, value] of uniforms) {
      const at = gl.getUniformLocation(program, name), v = [value].flat();
      if (kind === 'float') gl.uniform1f(at, v[0]); else if (kind === 'vec3') gl.uniform3fv(at, v.slice(0, 3)); else gl.uniform4fv(at, v.slice(0, 4));
    }
    // Color ramp tables, as Blender's GPU code makes them (GPU_color_band: half floats, sampled linearly).
    textures.forEach(([name, halves], i) => {
      gl.activeTexture(gl.TEXTURE1 + i);
      gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, halves.length / 4, 1, 0, gl.RGBA, gl.HALF_FLOAT, new Uint16Array(halves));
      for (const [key, value] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, key, value);
      gl.uniform1i(gl.getUniformLocation(program, name), 1 + i);
    });
    if (texel) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, image);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 1, 1, 0, gl.RGBA, gl.FLOAT, new Float32Array(texel));
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.uniform1i(gl.getUniformLocation(program, 'textureSampler'), 0);
    }
    gl.viewport(0, 0, 1, 1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const out = new Float32Array(4);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, out);
    return [...out];
  });
}

// Mesa's llvmpipe through ANGLE, the software OpenGL the fixtures were rendered with: Chromium's default SwiftShader
// takes minutes over a loop of 4D noise and gives nothing.
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=gl-egl', '--ignore-gpu-blocklist'] });
try {
  // In batches, each in a page of its own: a software GPU gives up on very many large programs in one context.
  const results = [];
  for (let i = 0; i < programs.length; i += 24) {
    const page = await browser.newPage();
    const batch = cases.slice(i, i + 24).map((c) => `${c.node} ${JSON.stringify(c.properties)}`);
    results.push(...await page.evaluate(run, programs.slice(i, i + 24)).catch((error) => { throw Error(`${batch.join('\n')}\n${error.message.slice(0, 300)}`); }));
    await page.close();
  }
  const failures = cases.flatMap((c, i) => {
    const got = results[i], channels = c.tree === 'shader' && socketType(declaration('shader', c.node).outputs.find((s) => s.identifier === c.output).type).kind === 'float' ? 1 : 4;
    const off = c.result.slice(0, channels).some((v, k) => v !== null && Math.abs(v - got[k]) > 1e-4 * Math.max(1, Math.abs(v)));
    return off ? [`${c.node} ${JSON.stringify(c.properties)}: Blender ${c.result.slice(0, channels)}, Bylonder ${got.slice(0, channels).map((v) => +v.toFixed(6))}`] : [];
  });
  assert.deepEqual(failures, [], `nodes differ from Blender:\n${failures.join('\n')}`);
  console.log(`nodes-gpu: ${cases.length} cases match Blender`);
} finally {
  await browser.close();
}
