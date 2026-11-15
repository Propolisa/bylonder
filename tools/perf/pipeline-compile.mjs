// How long the GPU takes to make a render pipeline from WGSL shaders, in Chrome on WebGPU (on Windows, Dawn's D3D12
// shader compile, DXC). For shaders gpu-profile.mjs writes (SHADERS=dir) and finds slow: a variant made by an edit
// (`--edit name`, from EDITS below, or `--edit stub:<function prefix>`; several joined by +) tells what in a shader the
// compiler spends its time on.
//   usage: node tools/perf/pipeline-compile.mjs <vertex.wgsl> <fragment.wgsl> [--edit name]...
// Each run is a fresh browser profile, so no compile cache answers; every variant is timed in the same browser.
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { chromium } from '../../tests/e2e/app.mjs';

// `stub:<prefix>`: the functions whose names start with <prefix> return zero (their callers keep calling them).
const stub = (prefix) => (code) => code.replace(new RegExp(`^fn ${prefix}[^\\n]*?(?:->\\s*([^{]+?))?\\s*\\{$`, 'gm'),
  (head, type) => `${head}\n  if (true) { return${type ? ` ${type.trim()}()` : ''}; }`);
const EDITS = {
  // Derivatives as zero.
  'no-derivatives': (code) => code.replace(/\bdpdx\(|\bdpdy\(|\bfwidth\(/g, '(0.0 * '),
  // Matrix inverses (expanded by the GLSL to WGSL conversion) as zero matrices.
  'no-inverse': (code) => code.replace(/^(\s*\w+) = \(s_\d+ \* mat4x4<f32>\(.*;$/gm, '$1 = mat4x4<f32>();'),
  // Every implicit-derivative sample at level 0.
  'sample-level': (code) => code.replace(/textureSample\(([^;]*)\);/g, 'textureSampleLevel($1, 0.0);'),
};
const args = process.argv.slice(2), files = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--edit');
const edits = args.flatMap((a, i) => (args[i - 1] === '--edit' ? [a] : []));
const [vertex, fragment] = files.map((f) => readFileSync(f, 'utf8'));
const edit = (name) => (name.startsWith('stub:') ? stub(name.slice(5)) : EDITS[name]);
const variants = [['as written', fragment], ...edits.map((e) => [e, e.split('+').reduce((code, name) => edit(name)(code), fragment)])];

const FORMATS = { f32: 'float32', 'vec2<f32>': 'float32x2', 'vec3<f32>': 'float32x3', 'vec4<f32>': 'float32x4', i32: 'sint32', u32: 'uint32', 'vec4<i32>': 'sint32x4', 'vec4<u32>': 'uint32x4' };
// One vertex buffer holding every input the vertex stage reads.
const attributes = [...vertex.slice(vertex.indexOf('@vertex')).split('{')[0].matchAll(/@location\((\d+)\)\s*\w+\s*:\s*([\w<>]+)/g)]
  .map(([, location, type], i) => ({ shaderLocation: Number(location), offset: i * 16, format: FORMATS[type] }));
const inputs = [{ arrayStride: attributes.length * 16, attributes }];

const browser = await chromium.launch({ args: ['--enable-unsafe-webgpu'] });
const page = await browser.newPage();
page.on('console', (m) => console.log('console:', m.text().slice(0, 400)));
// WebGPU needs a secure context: an empty page on localhost.
const server = createServer((request, response) => response.end('<!doctype html>')).listen(0, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));
await page.goto(`http://127.0.0.1:${server.address().port}/`);
for (const [name, code] of variants) {
  const result = await page.evaluate(async ({ vertex, fragment, buffers }) => {
    // The adapter's highest limits, as the app asks for (src/overrides/webgpu/maximum-limits.js).
    const adapter = await navigator.gpu.requestAdapter(), requiredLimits = {};
    for (const name in adapter.limits) requiredLimits[name] = adapter.limits[name];
    const device = await adapter.requestDevice({ requiredLimits });
    device.pushErrorScope('validation');
    const at = performance.now();
    try {
      await device.createRenderPipelineAsync({
        layout: 'auto',
        vertex: { module: device.createShaderModule({ code: vertex }), entryPoint: 'main', buffers },
        fragment: { module: device.createShaderModule({ code: fragment }), entryPoint: 'main', targets: [{ format: 'rgba16float' }] },
        depthStencil: { format: 'depth24plus-stencil8', depthWriteEnabled: true, depthCompare: 'less' },
      });
    } catch (error) { return { error: error.message }; }
    const error = await device.popErrorScope();
    return { ms: performance.now() - at, error: error?.message };
  }, { vertex, fragment: code, buffers: inputs });
  console.log(`${result.ms ? `${(result.ms / 1000).toFixed(1)} s`.padStart(8) : '  failed'}  ${name}${result.error ? `: ${result.error.slice(0, 300)}` : ''}`);
}
await browser.close();
server.close();
