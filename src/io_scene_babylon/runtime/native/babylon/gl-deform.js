// @ts-nocheck
// SPDX-License-Identifier: MIT OR Apache-2.0
// From babylon-blender-rig (scripts/native-rig.mjs).
// The modifier stack on WebGL 2: each pass is a fragment shader writing one float texel per vertex (RGBA32F render
// targets, ping-pong), the same kernels as the WebGPU compute deformer (gpu-deform.js): Armature (linear blend over
// joints or dual quaternions), Mask / Mirror / Subdivision (stencils), Lattice, Corrective Smooth (smoothing passes,
// then the corner correction), Surface Deform (stored bind), and vertex normals. The mesh draws from the last textures through RigVertexTexturePlugin
// (texelFetch by its vertex's welded index, through `axis`), so nothing returns to the CPU. Static data (influences,
// stencils, neighbours, corner offsets) is uploaded once; per frame the joint data, lattice displacements and, with
// shape keys, the input positions.
import { EffectRenderer, EffectWrapper } from '@babylonjs/core/Materials/effectRenderer.js';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture.js';
import { ThinTexture } from '@babylonjs/core/Materials/Textures/thinTexture.js';
import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase.js';
import { ShaderLanguage } from '@babylonjs/core/Materials/shaderLanguage.js';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer.js';
import { Constants } from '@babylonjs/core/Engines/constants.js';
import { Matrix } from '@babylonjs/core/Maths/math.vector.js';
import '@babylonjs/core/Engines/Extensions/engine.renderTarget.js';
import '@babylonjs/core/Engines/Extensions/engine.readTexture.js';
import { buildBinding, jointMatrices, dualQuatData, MAX_INFLUENCES } from '../deform/binding.js';
import { latticeFrame } from '../deform/lattice.js';
import { applyStencil } from '../deform/topology.js';
import { applyShapeKeys } from '../deform/shape-keys.js';
import { shapeKeyInput } from '../deform/cpu.js';
import { surfaceDeformTables } from '../deform/surface-deform.js';
import { hookTables, hookMatrix } from '../deform/hook.js';
import { evaluatedPositions } from '../deform/targets.js';
import { mulAffine, invertAffine } from '../rig/m4.js';

const MAX_WIDTH = 4096;
const VERTEX = 'attribute vec2 position;\nvoid main(void) { gl_Position = vec4(position, 0.0, 1.0); }\n';
// Sampler fetches are never nested (an index fetched from one sampler is held in a variable before it reads
// another): Chromium's WebGL 2 on Windows read the inner sampler for both.
const COMMON = `precision highp float;
precision highp int;
precision highp sampler2D;
uniform float outWidth;
uniform float outCount;
ivec2 texelOf(int i, int w) { return ivec2(i - (i / w) * w, i / w); }
int selfIndex() { return int(gl_FragCoord.y) * int(outWidth) + int(gl_FragCoord.x); }
`;
const KERNELS = {
  skin: { samplers: ['src', 'idx', 'wgt', 'joints'], uniforms: [], body: `
void main(void) {
  int v = selfIndex(); if (float(v) >= outCount) discard;
  vec4 p = vec4(fetch(src, v).xyz, 1.0); vec3 o = vec3(0.0);
  for (int h = 0; h < 2; h++) {
    vec4 i = fetch(idx, v * 2 + h), w = fetch(wgt, v * 2 + h);
    for (int k = 0; k < 4; k++) {
      if (w[k] == 0.0) continue;
      int j = int(i[k]) * 4;
      o += w[k] * (mat4(fetch(joints, j), fetch(joints, j + 1), fetch(joints, j + 2), fetch(joints, j + 3)) * p).xyz;
    }
  }
  gl_FragColor = vec4(o, 1.0);
}` },
  skinDQ: { samplers: ['src', 'idx', 'wgt', 'dq'], uniforms: ['pre', 'preInv', 'running'], body: `
uniform mat4 pre; uniform mat4 preInv; uniform float running;
vec4 qmul(vec4 a, vec4 b) { return vec4(a.w * b.xyz + b.w * a.xyz + cross(a.xyz, b.xyz), a.w * b.w - dot(a.xyz, b.xyz)); }
void main(void) {
  int v = selfIndex(); if (float(v) >= outCount) discard;
  vec3 c = fetch(src, v).xyz, p = (pre * vec4(c, 1.0)).xyz;
  vec4 Q = vec4(0.0), E = vec4(0.0), A = vec4(0.0), first = vec4(0.0); float m = 0.0;
  for (int h = 0; h < 2; h++) {
    vec4 i = fetch(idx, v * 2 + h), w = fetch(wgt, v * 2 + h);
    for (int k = 0; k < 4; k++) {
      if (w[k] == 0.0) continue;
      int o = int(i[k]) * 6;
      vec4 q = fetch(dq, o), e = fetch(dq, o + 1);
      mat4 S = mat4(fetch(dq, o + 2), fetch(dq, o + 3), fetch(dq, o + 4), fetch(dq, o + 5));
      if (m == 0.0) first = q;
      if (dot(q, running > 0.5 ? Q : first) < 0.0) { q = -q; e = -e; }
      A += w[k] * qmul(q, vec4((S * vec4(p, 1.0)).xyz, 0.0));
      Q += w[k] * q; E += w[k] * e; m += w[k];
    }
  }
  if (m == 0.0) { gl_FragColor = vec4(c, 1.0); return; }
  vec4 Qc = vec4(-Q.xyz, Q.w);
  vec3 d = (qmul(A, Qc).xyz + qmul(2.0 * E, Qc).xyz) / dot(Q, Q);
  gl_FragColor = vec4(mix(c, (preInv * vec4(d, 1.0)).xyz, m), 1.0);
}` },
  stencil: { samplers: ['src', 'rows', 'terms'], uniforms: ['frame', 'frameInv', 'mirror'], body: `
uniform mat4 frame; uniform mat4 frameInv; uniform float mirror;
void main(void) {
  int v = selfIndex(); if (float(v) >= outCount) discard;
  vec4 r = fetch(rows, v); vec3 o = vec3(0.0);
  for (int k = int(r.x); k < int(r.y); k++) {
    vec4 t = fetch(terms, k); int f = int(t.z);
    vec3 p = fetch(src, int(t.x)).xyz;
    if (f != 0) {
      if (mirror > 0.5) p = (frame * vec4(p, 1.0)).xyz;
      if ((f & 1) != 0) p.x = -p.x;
      if ((f & 2) != 0) p.y = -p.y;
      if ((f & 4) != 0) p.z = -p.z;
      if (mirror > 0.5) p = (frameInv * vec4(p, 1.0)).xyz;
    }
    o += t.y * p;
  }
  gl_FragColor = vec4(o, 1.0);
}` },
  lattice: { samplers: ['src', 'disp', 'mask'], uniforms: ['toLat', 'back', 'counts', 'kinds', 'lo', 'hi', 'useGroup', 'strength'], body: `
uniform mat4 toLat; uniform mat4 back; uniform vec3 counts; uniform vec3 kinds; uniform vec3 lo; uniform vec3 hi;
uniform float useGroup; uniform float strength;
vec4 spline(int kind, float t) {
  float t2 = t * t, t3 = t2 * t;
  if (kind == 0) return vec4(0.0, 1.0 - t, t, 0.0);
  if (kind == 3) return vec4((1.0 - t) * (1.0 - t) * (1.0 - t) / 6.0, (3.0 * t3 - 6.0 * t2 + 4.0) / 6.0, (-3.0 * t3 + 3.0 * t2 + 3.0 * t + 1.0) / 6.0, t3 / 6.0);
  float s = kind == 1 ? 0.71 : 0.5;
  return vec4(s * (-t3 + 2.0 * t2 - t), (2.0 - s) * t3 + (s - 3.0) * t2 + 1.0, (s - 2.0) * t3 + (3.0 - 2.0 * s) * t2 + s * t, s * (t3 - t2));
}
void main(void) {
  int v = selfIndex(); if (float(v) >= outCount) discard;
  vec3 c = fetch(src, v).xyz, p = (toLat * vec4(c, 1.0)).xyz;
  ivec4 ix[3]; vec4 wx[3];
  for (int a = 0; a < 3; a++) {
    int n = int(counts[a]);
    if (n <= 1) { ix[a] = ivec4(0, -1, -1, -1); wx[a] = vec4(1.0, 0.0, 0.0, 0.0); continue; }
    float f = (p[a] - lo[a]) / (hi[a] - lo[a]) * float(n - 1); int k = int(floor(f));
    wx[a] = spline(int(kinds[a]), f - float(k));
    ix[a] = clamp(ivec4(k - 1, k, k + 1, k + 2), 0, n - 1);
  }
  vec3 d = vec3(0.0); float g = 0.0; int nu = int(counts.x), nv = int(counts.y);
  for (int wi = 0; wi < 4; wi++) { if (ix[2][wi] < 0) continue;
    for (int vi = 0; vi < 4; vi++) { if (ix[1][vi] < 0) continue;
      for (int ui = 0; ui < 4; ui++) { if (ix[0][ui] < 0) continue;
        float w = wx[0][ui] * wx[1][vi] * wx[2][wi];
        vec4 t = fetch(disp, ix[0][ui] + nu * (ix[1][vi] + nv * ix[2][wi]));
        d += w * t.xyz; g += w * t.w;
      } } }
  vec3 q = p + (useGroup > 0.5 ? g : 1.0) * d;
  gl_FragColor = vec4(c + strength * fetch(mask, v).x * ((back * vec4(q, 1.0)).xyz - c), 1.0);
}` },
  smooth: { samplers: ['src', 'ranges', 'adjacency'], uniforms: [], body: `
void main(void) {
  int v = selfIndex(); if (float(v) >= outCount) discard;
  vec4 info4 = fetch(ranges, v); vec3 p = fetch(src, v).xyz;
  int s0 = int(info4.x), s1 = int(info4.y); float f = info4.z;
  vec3 s = vec3(0.0); float total = 0.0;
  if (f != 0.0 && s1 > s0) {
    for (int k = s0; k < s1; k++) {
      int j = int(fetch(adjacency, k).x);
      vec3 d = fetch(src, j).xyz - p;
      if (info4.w > 0.5) { float l = length(d); s += l * d; total += l; } else s += d;
    }
    if (info4.w > 0.5) s = total > 0.0 ? s * (2.0 / float(s1 - s0) / total) : vec3(0.0);
    else s /= float(s1 - s0);
  }
  gl_FragColor = vec4(p + f * s, 1.0);
}` },
  correct: { samplers: ['src', 'ranges', 'corners'], uniforms: ['scale'], body: `
uniform float scale;
void main(void) {
  int v = selfIndex(); if (float(v) >= outCount) discard;
  vec4 r = fetch(ranges, v); vec3 p = fetch(src, v).xyz, acc = vec3(0.0); float total = 0.0;
  for (int k = int(r.x); k < int(r.y); k++) {
    vec4 a = fetch(corners, k * 2); vec3 off = fetch(corners, k * 2 + 1).xyz;
    vec3 e1 = normalize(fetch(src, int(a.y)).xyz - p), e2 = normalize(fetch(src, int(a.x)).xyz - p);
    vec3 z = normalize(cross(e1, e2)), b = e1 + e2, x = normalize(b - dot(b, z) * z);
    // weight: pi minus the corner's angle in the smoothed deformed mesh
    float w = 3.14159265358979 - acos(clamp(dot(e1, e2), -1.0, 1.0));
    acc += w * (mat3(x, cross(z, x), z) * off);
    total += w;
  }
  if (total > 0.0) acc *= scale / total;
  gl_FragColor = vec4(p + acc, 1.0);
}` },
  surfaceDeform: { samplers: ['src', 'ranges', 'bindings', 'target'], uniforms: ['bindMatrix'], body: `
uniform mat4 bindMatrix;
vec3 tp(int i) { return fetch(target, i).xyz; }
void main(void) {
  int v = selfIndex(); if (float(v) >= outCount) discard;
  vec4 r = fetch(ranges, v); vec3 c = fetch(src, v).xyz;
  if (r.x < 0.0) { gl_FragColor = vec4(c, 1.0); return; }
  vec3 o = vec3(0.0);
  for (int b = int(r.x); b < int(r.y); b++) {
    vec4 m = fetch(bindings, b * 3), iv = fetch(bindings, b * 3 + 1), w = fetch(bindings, b * 3 + 2);
    vec3 P0 = tp(int(iv.x)), P1 = tp(int(iv.y)), P2 = tp(int(iv.z)), P3 = tp(int(iv.w));
    vec3 n = normalize(cross(P2 - P0, P3 - P1));
    vec3 p = w.x * P0 + w.y * P1;
    if (m.x > 1.5) p += w.z * 0.25 * (P0 + P1 + P2 + P3);
    else { p += w.z * P2; if (m.x > 0.5) p += w.w * P3; }
    o += m.y * (p + m.z * n);
  }
  o = (bindMatrix * vec4(o, 1.0)).xyz;
  gl_FragColor = vec4(c + r.z * (o - c), 1.0);
}` },
  hook: { samplers: ['src', 'factor'], uniforms: ['hookMatrix', 'hookInverse', 'falloffPrm', 'center'], body: `
uniform mat4 hookMatrix; uniform mat4 hookInverse; uniform vec4 falloffPrm; uniform vec3 center;
float falloffOf(int kind, float t) {
  if (kind == 2) return t; if (kind == 3) return 3.0 * t * t - 2.0 * t * t * t;
  if (kind == 4) return sqrt(2.0 * t - t * t); if (kind == 5) return sqrt(t);
  if (kind == 6) return t * (2.0 - t); if (kind == 7) return t * t; return 1.0;
}
void main(void) {
  int v = selfIndex(); if (float(v) >= outCount) discard;
  vec3 p = fetch(src, v).xyz; float f = fetch(factor, v).x; int kind = int(falloffPrm.x);
  if (f != 0.0 && kind != 0) {
    vec3 d = p - center;
    if (falloffPrm.z > 0.5) d = (hookInverse * vec4(d, 0.0)).xyz;
    float l = length(d);
    f = l >= falloffPrm.y ? 0.0 : f * falloffOf(kind, 1.0 - l / falloffPrm.y);
  }
  gl_FragColor = vec4(p + f * ((hookMatrix * vec4(p, 1.0)).xyz - p), 1.0);
}` },
  faceNormals: { samplers: ['src', 'ranges', 'idx'], uniforms: [], body: `
void main(void) {
  int f = selfIndex(); if (float(f) >= outCount) discard;
  vec4 r = fetch(ranges, f); int s = int(r.x), e = int(r.y); vec3 n = vec3(0.0);
  for (int i = s; i < e; i++) {
    int ia = int(fetch(idx, i).x), ib = int(fetch(idx, i + 1 == e ? s : i + 1).x);
    vec3 a = fetch(src, ia).xyz, b = fetch(src, ib).xyz;
    n += vec3((a.y - b.y) * (a.z + b.z), (a.z - b.z) * (a.x + b.x), (a.x - b.x) * (a.y + b.y));
  }
  gl_FragColor = vec4(n / max(length(n), 1e-30), 0.0);
}` },
  vertexNormals: { samplers: ['src', 'ranges', 'corners', 'faceN'], uniforms: [], body: `
void main(void) {
  int v = selfIndex(); if (float(v) >= outCount) discard;
  vec4 r = fetch(ranges, v); vec3 p = fetch(src, v).xyz, n = vec3(0.0);
  for (int k = int(r.x); k < int(r.y); k++) {
    vec4 c = fetch(corners, k);
    vec3 e1 = fetch(src, int(c.y)).xyz - p, e2 = fetch(src, int(c.z)).xyz - p;
    float cosA = dot(e1, e2) / max(length(e1) * length(e2), 1e-30);
    n += acos(clamp(cosA, -1.0, 1.0)) * fetch(faceN, int(c.x)).xyz;
  }
  gl_FragColor = vec4(n / max(length(n), 1e-30), 0.0);
}` },
};

// A kernel's fragment source. Samplers are never passed to functions (WebGPU's GLSL path rejects that): each
// `fetch(s, i)` of the kernel bodies becomes a read of the named sampler at its texel.
export function kernelSource(name) {
  const k = KERNELS[name];
  const reads = k.samplers.map((s) => `vec4 fetch_${s}(int i) { return texelFetch(${s}, texelOf(i, textureSize(${s}, 0).x), 0); }\n`).join('');
  const body = k.body.replace(/\bfetch\((\w+), /g, 'fetch_$1(');
  return COMMON + k.samplers.map((s) => `uniform sampler2D ${s};\n`).join('') + reads + body;
}

// For tests: the kernels' names and the GLSL the vertex-texture plugin injects.
export const kernelNames = () => Object.keys(KERNELS);
export const pluginVertexCode = () => RigVertexTexturePlugin.prototype.getCustomCode.call(null, 'vertex');

// Whether the WebGL 2 deformer covers a compiled deform (else CpuDeformer).
export function glSupported(deform) {
  const reasons = [...deform.unsupported];
  deform.steps.forEach((s, k) => {
    if (!GlDeformer.prototype[`compile${s.type}`]) reasons.push(`${s.type} (CPU only)`);
    if (s.type === 'ARMATURE' && s.multi && k > 0) reasons.push('Armature with Multi Modifier');
  });
  return { supported: !reasons.length, reasons };
}

export class GlDeformer {
  constructor(engine, inst, deform, mesh, { axis = null } = {}) {
    this.engine = engine; this.inst = inst; this.deform = deform; this.mesh = mesh;
    this.renderer = new EffectRenderer(engine);
    this.wrappers = [];
    this.passes = [];
    let rest = deform.shapeKeys ? applyShapeKeys(inst, deform) : Float64Array.from(deform.base);
    let count = rest.length / 3;
    // Input positions: static, or with shape keys computed on the CPU (sparse) and uploaded each frame.
    this.inputData = new Float32Array(texels(count).size * 4);
    this.input = this.dataTexture(pack4(rest, this.inputData), count);
    if (deform.shapeKeys) {
      const keys = shapeKeyInput(inst, deform), flat = new Float64Array(count * 3);
      this.updateInput = () => { keys(flat); pack4(flat, this.inputData); this.input.update(this.inputData); };
    }
    for (const step of deform.steps) {
      const pass = this[`compile${step.type}`](step, rest, count);
      this.passes.push(pass);
      if (pass.count !== undefined) {
        rest = applyStencil(step.stencil, rest, step.mirrorObject === undefined ? null : inst.program.restFrame(deform.mesh, step.mirrorObject));
        count = pass.count;
      }
    }
    this.count = count;
    if (mesh.isVerticesDataPresent(VertexBuffer.NormalKind) && deform.geo.faces.length) this.compileNormals(count);
    // The mesh draws through the plugin: per drawn vertex its welded vertex, and the axis map.
    const drawn = deform.draw ? deform.draw.length : count;
    mesh.setVerticesData('rigVertex', Float32Array.from({ length: drawn }, (_, i) => (deform.draw ? deform.draw[i] : i)), false, 1);
    mesh.metadata = { ...mesh.metadata, rigVertexTexture: { positions: null, normals: null, hasNormals: !!this.normals, axis: axis ? Matrix.FromArray(Array.from(axis.m ?? axis)) : Matrix.Identity() } };
    if (mesh.material && !mesh.material.pluginManager?.getPlugin?.('RigVertexTexture')) new RigVertexTexturePlugin(mesh.material);
  }

  // A float RGBA texture of `count` texels (rows of up to MAX_WIDTH).
  dataTexture(data, count) {
    const { width, height, size } = texels(count);
    let padded = data;
    if (data.length !== size * 4) { padded = new Float32Array(size * 4); padded.set(data.subarray(0, Math.min(data.length, padded.length))); }
    return new RawTexture(padded, width, height, Constants.TEXTUREFORMAT_RGBA, this.engine, false, false, Constants.TEXTURE_NEAREST_SAMPLINGMODE, Constants.TEXTURETYPE_FLOAT);
  }

  // A float render target of `count` texels, and its sampler view.
  target(count) {
    const { width, height } = texels(count);
    const rt = this.engine.createRenderTargetTexture({ width, height }, {
      type: Constants.TEXTURETYPE_FLOAT, format: Constants.TEXTUREFORMAT_RGBA, samplingMode: Constants.TEXTURE_NEAREST_SAMPLINGMODE,
      generateMipMaps: false, generateDepthBuffer: false, generateStencilBuffer: false,
    });
    return { rt, texture: new ThinTexture(rt.texture), width, height, count };
  }

  kernel(name) {
    const k = KERNELS[name];
    const w = new EffectWrapper({
      engine: this.engine, name: `rig-${name}`, vertexShader: VERTEX, fragmentShader: kernelSource(name),
      attributeNames: ['position'], uniformNames: ['outWidth', 'outCount', ...k.uniforms], samplerNames: k.samplers, shaderLanguage: ShaderLanguage.GLSL,
    });
    this.wrappers.push(w);
    return w;
  }

  // One fragment pass into `out`: bind(effect) sets its samplers and uniforms.
  draw(wrapper, out, bind) {
    const engine = this.engine, effect = wrapper.effect;
    engine.bindFramebuffer(out.rt, undefined, undefined, undefined, true);
    engine.setAlphaMode(Constants.ALPHA_DISABLE);
    this.renderer.applyEffectWrapper(wrapper);
    effect.setFloat('outWidth', out.width);
    effect.setFloat('outCount', out.count);
    bind(effect);
    this.renderer.draw();
    engine.unBindFramebuffer(out.rt);
  }

  compileARMATURE(step, rest, count) {
    const synthetic = { mesh: this.deform.mesh, base: rest, modifiers: [step], steps: [step], shapeKeys: null };
    const binding = buildBinding(this.inst, synthetic);
    const idx = new Float32Array(count * MAX_INFLUENCES), wgt = new Float32Array(count * MAX_INFLUENCES);
    idx.set(binding.indices); wgt.set(binding.weights);
    const idxTex = this.dataTexture(idx, count * 2), wgtTex = this.dataTexture(wgt, count * 2), out = this.target(count);
    if (binding.dq) {
      const texelsPerJoint = 6, data = new Float32Array(texels(Math.max(1, binding.joints.length) * texelsPerJoint).size * 4);
      const dqTex = this.dataTexture(data, Math.max(1, binding.joints.length) * texelsPerJoint), wrapper = this.kernel('skinDQ');
      const pre = new Float32Array(16), preInv = new Float32Array(16);
      return {
        out,
        run: (src) => {
          const d = dualQuatData(this.inst, synthetic, binding, data.subarray(0, binding.joints.length * 24));
          dqTex.update(data); pre.set(d.pre); preInv.set(d.preInv);
          this.draw(wrapper, out, (e) => { e.setTexture('src', src); e.setTexture('idx', idxTex); e.setTexture('wgt', wgtTex); e.setTexture('dq', dqTex); e.setMatrices('pre', pre); e.setMatrices('preInv', preInv); e.setFloat('running', binding.running ? 1 : 0); });
        },
      };
    }
    const data = new Float32Array(texels((binding.joints.length + 1) * 4).size * 4), joints = this.dataTexture(data, (binding.joints.length + 1) * 4);
    const wrapper = this.kernel('skin');
    return {
      out,
      run: (src) => {
        jointMatrices(this.inst, synthetic, binding, data.subarray(0, (binding.joints.length + 1) * 16));
        joints.update(data);
        this.draw(wrapper, out, (e) => { e.setTexture('src', src); e.setTexture('idx', idxTex); e.setTexture('wgt', wgtTex); e.setTexture('joints', joints); });
      },
    };
  }

  compileStencil(step) {
    const st = step.stencil, rows = new Float32Array(st.count * 4), terms = new Float32Array(st.src.length * 4);
    for (let i = 0; i < st.count; i++) { rows[i * 4] = st.start[i]; rows[i * 4 + 1] = st.start[i + 1]; }
    for (let k = 0; k < st.src.length; k++) { terms[k * 4] = st.src[k]; terms[k * 4 + 1] = st.weight[k]; terms[k * 4 + 2] = st.flip[k]; }
    const rowsTex = this.dataTexture(rows, st.count), termsTex = this.dataTexture(terms, Math.max(1, st.src.length));
    const out = this.target(st.count), wrapper = this.kernel('stencil');
    const F = new Float64Array(16), Fi = new Float64Array(16), F32 = new Float32Array(16), Fi32 = new Float32Array(16), mirror = step.mirrorObject !== undefined;
    return {
      out, count: st.count,
      run: (src) => {
        if (mirror) {
          invertAffine(Fi, 0, this.inst.world, step.mirrorObject * 16);
          mulAffine(F, 0, Fi, 0, this.inst.world, this.deform.mesh * 16);
          invertAffine(Fi, 0, F, 0);
          F32.set(F); Fi32.set(Fi);
        }
        this.draw(wrapper, out, (e) => {
          e.setTexture('src', src); e.setTexture('rows', rowsTex); e.setTexture('terms', termsTex);
          e.setMatrices('frame', F32); e.setMatrices('frameInv', Fi32); e.setFloat('mirror', mirror ? 1 : 0);
        });
      },
    };
  }

  compileMASK(step) { return this.compileStencil(step); }
  compileMIRROR(step) { return this.compileStencil(step); }
  compileSUBSURF(step) { return this.compileStencil(step); }

  compileLATTICE(step, rest, count) {
    const mask = this.dataTexture(Float32Array.from({ length: count * 4 }, (_, i) => (i % 4 ? 0 : step.mask ? step.mask[i / 4] : 1)), count);
    const n0 = latticeFrame(this.inst, step.lattice).disp.length / 3, disp = new Float32Array(texels(n0).size * 4), dispTex = this.dataTexture(disp, n0);
    const out = this.target(count), wrapper = this.kernel('lattice'), KIND = { KEY_LINEAR: 0, KEY_CARDINAL: 1, KEY_CATMULL_ROM: 2, KEY_BSPLINE: 3 };
    const toLat = new Float64Array(16), inv = new Float64Array(16), back = new Float64Array(16), toLat32 = new Float32Array(16), back32 = new Float32Array(16);
    return {
      out,
      run: (src) => {
        const L = latticeFrame(this.inst, step.lattice), w = this.inst.world;
        for (let i = 0; i < n0; i++) { disp.set(L.disp.subarray(i * 3, i * 3 + 3), i * 4); disp[i * 4 + 3] = L.group ? L.group[i] ?? 0 : 1; }
        dispTex.update(disp);
        invertAffine(inv, 0, w, step.lattice * 16);
        mulAffine(toLat, 0, inv, 0, w, this.deform.mesh * 16);
        invertAffine(back, 0, toLat, 0);
        toLat32.set(toLat); back32.set(back);
        const kinds = L.interp.map((k) => KIND[k] ?? 3);
        this.draw(wrapper, out, (e) => {
          e.setTexture('src', src); e.setTexture('disp', dispTex); e.setTexture('mask', mask);
          e.setMatrices('toLat', toLat32); e.setMatrices('back', back32);
          e.setFloat3('counts', L.nu, L.nv, L.nw); e.setFloat3('kinds', kinds[0], kinds[1], kinds[2]);
          e.setFloat3('lo', L.range[0][0], L.range[1][0], L.range[2][0]); e.setFloat3('hi', L.range[0][1], L.range[1][1], L.range[2][1]);
          e.setFloat('useGroup', L.group ? 1 : 0); e.setFloat('strength', step.strength);
        });
      },
    };
  }

  compileCORRECTIVE_SMOOTH(step, rest, count) {
    const info = new Float32Array(count * 4), nb = [];
    step.neighbours.forEach((list, v) => {
      info[v * 4] = nb.length; nb.push(...list); info[v * 4 + 1] = nb.length;
      info[v * 4 + 2] = step.factor[v]; info[v * 4 + 3] = step.lengthWeighted ? 1 : 0;
    });
    // Per corner: previous and next vertex, and the rest offset in the rest corner frame (Fr^T (R - Rs)).
    const R = step.rest, Rs = step.restSmooth, cInfo = new Float32Array(count * 4), corners = [];
    step.corners.forEach((list, v) => {
      cInfo[v * 4] = corners.length / 8;
      const off = [R[v * 3] - Rs[v * 3], R[v * 3 + 1] - Rs[v * 3 + 1], R[v * 3 + 2] - Rs[v * 3 + 2]];
      for (const [prev, next] of list) {
        const F = cornerFrame(Rs, v, prev, next);
        corners.push(prev, next, 0, 0, ...F.map((c) => c[0] * off[0] + c[1] * off[1] + c[2] * off[2]), 0);
      }
      cInfo[v * 4 + 1] = corners.length / 8;
    });
    const infoTex = this.dataTexture(info, count), nbTex = this.dataTexture(Float32Array.from(nb.flatMap((j) => [j, 0, 0, 0])), Math.max(1, nb.length));
    const cInfoTex = this.dataTexture(cInfo, count), cornersTex = this.dataTexture(Float32Array.from(corners), Math.max(1, corners.length / 4));
    const smooth = this.kernel('smooth'), correct = this.kernel('correct');
    const ping = this.target(count), pong = this.target(count), corrected = this.target(count);
    const pass = {
      out: corrected,
      run: (src) => {
        let a = src, b = ping;
        for (let i = 0; i < step.iterations; i++) {
          const from = a;
          this.draw(smooth, b, (e) => { e.setTexture('src', from); e.setTexture('ranges', infoTex); e.setTexture('adjacency', nbTex); });
          a = b.texture; b = b === ping ? pong : ping;
        }
        if (step.onlySmooth) { pass.passThrough = a; return; }
        this.draw(correct, corrected, (e) => { e.setTexture('src', a); e.setTexture('ranges', cInfoTex); e.setTexture('corners', cornersTex); e.setFloat('scale', step.scale); });
      },
    };
    return pass;
  }

  compileHOOK(step, rest, count) {
    const t = hookTables(step, count);
    const tex = this.dataTexture(Float32Array.from({ length: count * 4 }, (_, i) => (i % 4 ? 0 : t.factor[i / 4])), count);
    const out = this.target(count), wrapper = this.kernel('hook'), M = new Float32Array(16), I = Float32Array.from(step.inverse);
    return {
      out,
      run: (src) => {
        M.set(hookMatrix(this.inst, this.deform.mesh, step));
        this.draw(wrapper, out, (e) => {
          e.setTexture('src', src); e.setTexture('factor', tex);
          e.setMatrices('hookMatrix', M); e.setMatrices('hookInverse', I);
          e.setFloat4('falloffPrm', t.falloff[0], t.falloff[1], t.falloff[2], 0); e.setFloat3('center', step.center[0], step.center[1], step.center[2]);
        });
      },
    };
  }

  // The target's evaluated positions come from the CPU (targets.js, once per evaluate) and are uploaded each frame.
  compileSURFACE_DEFORM(step, rest, count) {
    const t = surfaceDeformTables(step, count), nb = step.mode.length;
    const ranges = this.dataTexture(t.ranges, count), bindings = this.dataTexture(t.bindings, Math.max(1, nb) * 3);
    const tCount = evaluatedPositions(this.inst, step.target).length / 3, tData = new Float32Array(texels(tCount).size * 4), target = this.dataTexture(tData, tCount);
    const out = this.target(count), wrapper = this.kernel('surfaceDeform');
    return {
      out,
      run: (src) => {
        pack4(evaluatedPositions(this.inst, step.target), tData);
        target.update(tData);
        this.draw(wrapper, out, (e) => { e.setTexture('src', src); e.setTexture('ranges', ranges); e.setTexture('bindings', bindings); e.setTexture('target', target); e.setMatrices('bindMatrix', t.matrix); });
      },
    };
  }

  // Face normals, then per vertex the angle-weighted sum over its corners (as the CPU path).
  compileNormals(count) {
    const faces = this.deform.geo.faces, fInfo = new Float32Array(faces.length * 4), fIdx = [];
    faces.forEach((f, i) => { fInfo[i * 4] = fIdx.length; fIdx.push(...f); fInfo[i * 4 + 1] = fIdx.length; });
    const cornersOf = Array.from({ length: count }, () => []);
    faces.forEach((f, fi) => f.forEach((v, i) => cornersOf[v].push(fi, f[(i + f.length - 1) % f.length], f[(i + 1) % f.length], 0)));
    const vInfo = new Float32Array(count * 4), corners = [];
    cornersOf.forEach((c, v) => { vInfo[v * 4] = corners.length / 4; corners.push(...c); vInfo[v * 4 + 1] = corners.length / 4; });
    const fInfoTex = this.dataTexture(fInfo, faces.length), fIdxTex = this.dataTexture(Float32Array.from(fIdx.flatMap((i) => [i, 0, 0, 0])), fIdx.length);
    const vInfoTex = this.dataTexture(vInfo, count), cornersTex = this.dataTexture(Float32Array.from(corners), Math.max(1, corners.length / 4));
    const faceN = this.target(faces.length), vertexN = this.target(count), fK = this.kernel('faceNormals'), vK = this.kernel('vertexNormals');
    this.normals = vertexN;
    this.normalPass = (src) => {
      this.draw(fK, faceN, (e) => { e.setTexture('src', src); e.setTexture('ranges', fInfoTex); e.setTexture('idx', fIdxTex); });
      this.draw(vK, vertexN, (e) => { e.setTexture('src', src); e.setTexture('ranges', vInfoTex); e.setTexture('corners', cornersTex); e.setTexture('faceN', faceN.texture); });
    };
  }

  // Resolves once every kernel is compiled (a pass before that draws nothing).
  async whenReady() {
    while (!this.wrappers.every((w) => w.isReady())) await new Promise((ok) => setTimeout(ok, 10));
  }

  // Runs the stack for this frame (after inst.evaluate()).
  update() {
    if (!this.wrappers.every((w) => w.isReady())) return;
    this.updateInput?.();
    let cur = this.input;
    for (const p of this.passes) {
      p.run(cur);
      cur = p.passThrough ?? p.out.texture;
    }
    this.output = cur;
    this.normalPass?.(cur);
    const data = this.mesh.metadata.rigVertexTexture;
    data.positions = cur; data.normals = this.normals?.texture ?? null;
  }

  // Positions read back (tests): Float32Array of xyz per welded vertex.
  async read() { return readXYZ(this.engine, this.output, this.count); }
  async readNormals() { return this.normals ? readXYZ(this.engine, this.normals.texture, this.count) : null; }
}

async function readXYZ(engine, texture, count) {
  const t = texture.getInternalTexture(), raw = await engine._readTexturePixels(t, t.width, t.height);
  const f = new Float32Array(raw.buffer, raw.byteOffset, t.width * t.height * 4), out = new Float32Array(count * 3);
  for (let v = 0; v < count; v++) out.set(f.subarray(v * 4, v * 4 + 3), v * 3);
  return out;
}

function texels(count) {
  const width = Math.max(1, Math.min(count, MAX_WIDTH)), height = Math.max(1, Math.ceil(count / width));
  return { width, height, size: width * height };
}

function pack4(xyz, out) {
  const n = xyz.length / 3;
  for (let v = 0; v < n; v++) { out[v * 4] = xyz[v * 3]; out[v * 4 + 1] = xyz[v * 3 + 1]; out[v * 4 + 2] = xyz[v * 3 + 2]; out[v * 4 + 3] = 1; }
  return out;
}

function cornerFrame(P, v, prev, next) {
  const sub = (a, b) => [P[a * 3] - P[b * 3], P[a * 3 + 1] - P[b * 3 + 1], P[a * 3 + 2] - P[b * 3 + 2]];
  const norm = (a) => { const l = Math.hypot(...a) || 1; return a.map((x) => x / l); };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const e1 = norm(sub(next, v)), e2 = norm(sub(prev, v)), z = norm(cross(e1, e2));
  let x = e1.map((c, i) => c + e2[i]);
  const d = x[0] * z[0] + x[1] * z[1] + x[2] * z[2];
  x = norm(x.map((c, i) => c - d * z[i]));
  return [x, cross(z, x), z];
}

// Draws a mesh from the deformer's textures: position and normal of its welded vertex (vertex buffer rigVertex),
// mapped by `axis`. The mesh's own positions stay as they are (bounds).
export class RigVertexTexturePlugin extends MaterialPluginBase {
  constructor(material) {
    super(material, 'RigVertexTexture', 210, { RIGVTEX: false, RIGVTEXNORMAL: false });
    this._enable(true);
  }

  getClassName() { return 'RigVertexTexturePlugin'; }

  isCompatible(language) { return language === ShaderLanguage.GLSL; }

  prepareDefines(defines, scene, mesh) {
    const data = mesh.metadata?.rigVertexTexture;
    defines.RIGVTEX = !!data;
    defines.RIGVTEXNORMAL = !!data?.hasNormals;
  }

  getAttributes(attributes, scene, mesh) {
    if (mesh.metadata?.rigVertexTexture) attributes.push('rigVertex');
  }

  getSamplers(samplers) { samplers.push('rigPositions', 'rigNormals'); }

  getUniforms() {
    return {
      ubo: [{ name: 'rigAxis', size: 16, type: 'mat4' }],
      vertex: '#ifdef RIGVTEX\nuniform mat4 rigAxis;\n#endif\n',
    };
  }

  bindForSubMesh(ubo, scene, engine, subMesh) {
    const data = subMesh.getMesh().metadata?.rigVertexTexture;
    if (!data?.positions) return;
    ubo.updateMatrix('rigAxis', data.axis);
    ubo.setTexture('rigPositions', data.positions);
    if (data.normals) ubo.setTexture('rigNormals', data.normals);
  }

  getCustomCode(shaderType) {
    if (shaderType !== 'vertex') return null;
    return {
      CUSTOM_VERTEX_DEFINITIONS: `#ifdef RIGVTEX
attribute float rigVertex;
uniform highp sampler2D rigPositions;
#ifdef RIGVTEXNORMAL
uniform highp sampler2D rigNormals;
#endif
// Texel coordinates of a vertex; each sampler is read where it is named (WebGPU's GLSL path rejects sampler parameters).
ivec2 rigTexel(int i, int w) { return ivec2(i - (i / w) * w, i / w); }
#endif
`,
      CUSTOM_VERTEX_UPDATE_POSITION: `#ifdef RIGVTEX
positionUpdated = (rigAxis * vec4(texelFetch(rigPositions, rigTexel(int(rigVertex), textureSize(rigPositions, 0).x), 0).xyz, 1.0)).xyz;
#if defined(NORMAL) && defined(RIGVTEXNORMAL)
normalUpdated = mat3(rigAxis) * texelFetch(rigNormals, rigTexel(int(rigVertex), textureSize(rigNormals, 0).x), 0).xyz;
#endif
#endif
`,
    };
  }
}
