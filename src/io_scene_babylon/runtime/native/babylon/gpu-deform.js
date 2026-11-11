// @ts-nocheck
// SPDX-License-Identifier: MIT OR Apache-2.0
// From babylon-blender-rig (scripts/native-rig.mjs).
// The whole modifier stack on WebGPU compute (Babylon ComputeShader over storage buffers): Armature (linear blend over
// joints), Mask / Mirror / Subdivision (stencils), Lattice, Corrective Smooth, then vertex normals; the last buffer is
// the mesh's position vertex buffer. Static data (influences, stencils, neighbours, corner offsets) is built once from
// the rest geometry; per frame only joint matrices and small parameter buffers are uploaded. WebGL 2 and anything the
// kernels do not cover use src/deform/mesh.js on the CPU (`CpuDeformer` below), which is also the reference.
import { ComputeShader } from '@babylonjs/core/Compute/computeShader.js';
import '@babylonjs/core/Engines/WebGPU/Extensions/engine.computeShader.js';
import { StorageBuffer } from '@babylonjs/core/Buffers/storageBuffer.js';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer.js';
import { Constants } from '@babylonjs/core/Engines/constants.js';
import { buildBinding, jointMatrices, dualQuatData, MAX_INFLUENCES } from '../deform/binding.js';
import { latticeFrame } from '../deform/lattice.js';
import { deformMesh, drawnPositions } from '../deform/mesh.js';
import { vertexNormals } from '../deform/displace.js';
import { applyShapeKeys } from '../deform/shape-keys.js';
import { mulAffine, invertAffine } from '../rig/m4.js';
import { applyStencil } from '../deform/topology.js';

const WG = 64;
const RW = Constants.BUFFER_CREATIONFLAG_READWRITE | Constants.BUFFER_CREATIONFLAG_VERTEX;
const RO = Constants.BUFFER_CREATIONFLAG_READ | Constants.BUFFER_CREATIONFLAG_WRITE;

const HEADER = 'struct P { v : array<vec4<f32>> };\n';
const KERNELS = {
  skin: `${HEADER}
@group(0) @binding(0) var<storage, read> src : P;
@group(0) @binding(1) var<storage, read_write> dst : P;
@group(0) @binding(2) var<storage, read> joints : array<mat4x4<f32>>;
@group(0) @binding(3) var<storage, read> idx : array<vec4<u32>>;
@group(0) @binding(4) var<storage, read> wgt : array<vec4<f32>>;
@compute @workgroup_size(${WG}) fn main(@builtin(global_invocation_id) id : vec3<u32>) {
  let v = id.x; if (v >= arrayLength(&dst.v)) { return; }
  let p = vec4<f32>(src.v[v].xyz, 1.0);
  var o = vec3<f32>(0.0);
  for (var h = 0u; h < 2u; h++) {
    let i = idx[v * 2u + h]; let w = wgt[v * 2u + h];
    for (var k = 0u; k < 4u; k++) { if (w[k] != 0.0) { o += w[k] * (joints[i[k]] * p).xyz; } }
  }
  dst.v[v] = vec4<f32>(o, 1.0);
}`,
  skinDQ: `${HEADER}
@group(0) @binding(0) var<storage, read> src : P;
@group(0) @binding(1) var<storage, read_write> dst : P;
@group(0) @binding(2) var<storage, read> dq : array<vec4<f32>>;
@group(0) @binding(3) var<storage, read> idx : array<vec4<u32>>;
@group(0) @binding(4) var<storage, read> wgt : array<vec4<f32>>;
@group(0) @binding(5) var<storage, read> pre : array<mat4x4<f32>>;
fn qmul(a : vec4<f32>, b : vec4<f32>) -> vec4<f32> { return vec4<f32>(a.w * b.xyz + b.w * a.xyz + cross(a.xyz, b.xyz), a.w * b.w - dot(a.xyz, b.xyz)); }
@compute @workgroup_size(${WG}) fn main(@builtin(global_invocation_id) id : vec3<u32>) {
  let v = id.x; if (v >= arrayLength(&dst.v)) { return; }
  let c = src.v[v].xyz; let p = (pre[0] * vec4<f32>(c, 1.0)).xyz;
  var Q = vec4<f32>(0.0); var E = vec4<f32>(0.0); var A = vec4<f32>(0.0); var first = vec4<f32>(0.0); var m = 0.0;
  for (var h = 0u; h < 2u; h++) {
    let i = idx[v * 2u + h]; let w = wgt[v * 2u + h];
    for (var k = 0u; k < 4u; k++) {
      if (w[k] == 0.0) { continue; }
      let o = i[k] * 6u;
      var q = dq[o]; var e = dq[o + 1u];
      let S = mat4x4<f32>(dq[o + 2u], dq[o + 3u], dq[o + 4u], dq[o + 5u]);
      if (m == 0.0) { first = q; }
      if (dot(q, first) < 0.0) { q = -q; e = -e; }
      A += w[k] * qmul(q, vec4<f32>((S * vec4<f32>(p, 1.0)).xyz, 0.0));
      Q += w[k] * q; E += w[k] * e; m += w[k];
    }
  }
  if (m == 0.0) { dst.v[v] = vec4<f32>(c, 1.0); return; }
  let N = dot(Q, Q); let Qc = vec4<f32>(-Q.xyz, Q.w);
  let d = (qmul(A, Qc).xyz + qmul(2.0 * E, Qc).xyz) / N;
  dst.v[v] = vec4<f32>(mix(c, (pre[1] * vec4<f32>(d, 1.0)).xyz, m), 1.0);
}`,
  stencil: `${HEADER}
@group(0) @binding(0) var<storage, read> src : P;
@group(0) @binding(1) var<storage, read_write> dst : P;
@group(0) @binding(2) var<storage, read> start : array<u32>;
@group(0) @binding(3) var<storage, read> terms : array<vec4<f32>>;
@group(0) @binding(4) var<storage, read> frames : array<mat4x4<f32>>;
@compute @workgroup_size(${WG}) fn main(@builtin(global_invocation_id) id : vec3<u32>) {
  let v = id.x; if (v >= arrayLength(&dst.v)) { return; }
  var o = vec3<f32>(0.0);
  for (var k = start[v]; k < start[v + 1u]; k++) {
    let t = terms[k]; let s = u32(t.x); let f = u32(t.z);
    var p = src.v[s].xyz;
    if (f != 0u) {
      p = (frames[0] * vec4<f32>(p, 1.0)).xyz;
      if ((f & 1u) != 0u) { p.x = -p.x; } if ((f & 2u) != 0u) { p.y = -p.y; } if ((f & 4u) != 0u) { p.z = -p.z; }
      p = (frames[1] * vec4<f32>(p, 1.0)).xyz;
    }
    o += t.y * p;
  }
  dst.v[v] = vec4<f32>(o, 1.0);
}`,
  lattice: `${HEADER}
@group(0) @binding(0) var<storage, read> src : P;
@group(0) @binding(1) var<storage, read_write> dst : P;
@group(0) @binding(2) var<storage, read> disp : array<vec4<f32>>;
@group(0) @binding(3) var<storage, read> mats : array<mat4x4<f32>>;
@group(0) @binding(4) var<storage, read> prm : array<vec4<f32>>;
@group(0) @binding(5) var<storage, read> mask : array<f32>;
fn spline(kind : u32, t : f32) -> vec4<f32> {
  let t2 = t * t; let t3 = t2 * t;
  if (kind == 0u) { return vec4<f32>(0.0, 1.0 - t, t, 0.0); }
  if (kind == 3u) { return vec4<f32>((1.0 - t) * (1.0 - t) * (1.0 - t) / 6.0, (3.0 * t3 - 6.0 * t2 + 4.0) / 6.0, (-3.0 * t3 + 3.0 * t2 + 3.0 * t + 1.0) / 6.0, t3 / 6.0); }
  let s = select(0.5, 0.71, kind == 1u);
  return vec4<f32>(s * (-t3 + 2.0 * t2 - t), (2.0 - s) * t3 + (s - 3.0) * t2 + 1.0, (s - 2.0) * t3 + (3.0 - 2.0 * s) * t2 + s * t, s * (t3 - t2));
}
@compute @workgroup_size(${WG}) fn main(@builtin(global_invocation_id) id : vec3<u32>) {
  let v = id.x; if (v >= arrayLength(&dst.v)) { return; }
  let n = vec3<u32>(prm[0].xyz); let kinds = vec3<u32>(prm[1].xyz); let lo = prm[2].xyz; let hi = prm[3].xyz;
  let useGroup = prm[0].w; let strength = prm[1].w;
  let c = src.v[v].xyz; let p = (mats[0] * vec4<f32>(c, 1.0)).xyz;
  var ix : array<vec4<i32>, 3>; var wx : array<vec4<f32>, 3>;
  for (var a = 0u; a < 3u; a++) {
    if (n[a] <= 1u) { ix[a] = vec4<i32>(0, -1, -1, -1); wx[a] = vec4<f32>(1.0, 0.0, 0.0, 0.0); continue; }
    let f = (p[a] - lo[a]) / (hi[a] - lo[a]) * f32(n[a] - 1u); let k = i32(floor(f));
    wx[a] = spline(kinds[a], f - f32(k));
    let m = i32(n[a]) - 1;
    ix[a] = vec4<i32>(clamp(k - 1, 0, m), clamp(k, 0, m), clamp(k + 1, 0, m), clamp(k + 2, 0, m));
  }
  var d = vec3<f32>(0.0); var g = 0.0;
  for (var wi = 0u; wi < 4u; wi++) { if (ix[2][wi] < 0) { continue; }
    for (var vi = 0u; vi < 4u; vi++) { if (ix[1][vi] < 0) { continue; }
      for (var ui = 0u; ui < 4u; ui++) { if (ix[0][ui] < 0) { continue; }
        let w = wx[0][ui] * wx[1][vi] * wx[2][wi];
        let i = u32(ix[0][ui]) + n.x * (u32(ix[1][vi]) + n.y * u32(ix[2][wi]));
        d += w * disp[i].xyz; g += w * disp[i].w;
      } } }
  let q = p + select(1.0, g, useGroup > 0.5) * d;
  let back = (mats[1] * vec4<f32>(q, 1.0)).xyz;
  dst.v[v] = vec4<f32>(c + strength * mask[v] * (back - c), 1.0);
}`,
  smooth: `${HEADER}
@group(0) @binding(0) var<storage, read> src : P;
@group(0) @binding(1) var<storage, read_write> dst : P;
@group(0) @binding(2) var<storage, read> start : array<u32>;
@group(0) @binding(3) var<storage, read> nb : array<u32>;
@group(0) @binding(4) var<storage, read> factor : array<f32>;
@compute @workgroup_size(${WG}) fn main(@builtin(global_invocation_id) id : vec3<u32>) {
  let v = id.x; if (v >= arrayLength(&dst.v)) { return; }
  let p = src.v[v].xyz; let f = factor[v * 2u]; let lengthWeighted = factor[v * 2u + 1u];
  let count = start[v + 1u] - start[v];
  var s = vec3<f32>(0.0); var total = 0.0;
  for (var k = start[v]; k < start[v + 1u]; k++) {
    let d = src.v[nb[k]].xyz - p;
    if (lengthWeighted > 0.5) { let l = length(d); s += l * d; total += l; } else { s += d; }
  }
  if (count > 0u) {
    if (lengthWeighted > 0.5) { if (total > 0.0) { s = s * (2.0 / f32(count) / total); } else { s = vec3<f32>(0.0); } }
    else { s = s / f32(count); }
  }
  dst.v[v] = vec4<f32>(p + f * s, 1.0);
}`,
  correct: `${HEADER}
@group(0) @binding(0) var<storage, read> src : P;
@group(0) @binding(1) var<storage, read_write> dst : P;
@group(0) @binding(2) var<storage, read> start : array<u32>;
@group(0) @binding(3) var<storage, read> corners : array<vec4<f32>>;
@group(0) @binding(4) var<storage, read> prm : array<f32>;
fn frame(v : vec3<f32>, prev : vec3<f32>, next : vec3<f32>) -> mat3x3<f32> {
  let e1 = normalize(next - v); let e2 = normalize(prev - v);
  let z = normalize(cross(e1, e2)); let b = e1 + e2;
  let x = normalize(b - dot(b, z) * z);
  return mat3x3<f32>(x, cross(z, x), z);
}
@compute @workgroup_size(${WG}) fn main(@builtin(global_invocation_id) id : vec3<u32>) {
  let v = id.x; if (v >= arrayLength(&dst.v)) { return; }
  let p = src.v[v].xyz; var acc = vec3<f32>(0.0);
  let count = start[v + 1u] - start[v];
  for (var k = start[v]; k < start[v + 1u]; k++) {
    let a = corners[k * 2u]; let off = corners[k * 2u + 1u].xyz;
    acc += frame(p, src.v[u32(a.x)].xyz, src.v[u32(a.y)].xyz) * off;
  }
  if (count > 0u) { acc = acc * (prm[0] / f32(count)); }
  dst.v[v] = vec4<f32>(p + acc, 1.0);
}`,
};

const bind = (names) => Object.fromEntries(names.map((n, i) => [n, { group: 0, binding: i }]));
const BINDINGS = {
  skin: bind(['src', 'dst', 'joints', 'idx', 'wgt']),
  skinDQ: bind(['src', 'dst', 'dq', 'idx', 'wgt', 'pre']),
  stencil: bind(['src', 'dst', 'start', 'terms', 'frames']),
  lattice: bind(['src', 'dst', 'disp', 'mats', 'prm', 'mask']),
  smooth: bind(['src', 'dst', 'start', 'nb', 'factor']),
  correct: bind(['src', 'dst', 'start', 'corners', 'prm']),
};

// Whether the GPU deformer covers a compiled deform (else CpuDeformer).
export function gpuSupported(deform) {
  const reasons = [...deform.unsupported];
  deform.steps.forEach((s, k) => {
    if (!GpuDeformer.prototype[`compile${s.type}`]) reasons.push(`${s.type} (CPU only)`);
    if (s.type === 'ARMATURE' && s.multi && k > 0) reasons.push('Armature with Multi Modifier');
  });
  return { supported: !reasons.length, reasons };
}

export class GpuDeformer {
  constructor(engine, inst, deform, mesh) {
    this.engine = engine; this.inst = inst; this.deform = deform; this.mesh = mesh;
    this.passes = [];
    let rest = deform.shapeKeys ? applyShapeKeys(inst, deform) : deform.base;
    let count = rest.length / 3;
    this.input = this.positions(count, rest);
    let cur = this.input;
    for (const step of deform.steps) {
      const pass = this[`compile${step.type}`](step, rest, count);
      const out = this.positions(pass.count ?? count);
      this.passes.push({ ...pass, src: cur, dst: out, step, n: pass.count ?? count });
      cur = out; count = pass.count ?? count;
      rest = pass.rest ?? rest;
    }
    // draw_vertices: a last gather pass writes one position per Babylon vertex.
    if (deform.draw) {
      const st = { start: Int32Array.from({ length: deform.draw.length + 1 }, (_, i) => i), src: deform.draw, weight: new Float64Array(deform.draw.length).fill(1), flip: new Uint8Array(deform.draw.length), count: deform.draw.length };
      const pass = this.compileStencil({ stencil: st }, rest);
      const out = this.positions(st.count);
      this.passes.push({ ...pass, src: cur, dst: out, n: st.count });
      cur = out; count = st.count;
    }
    this.output = cur;
    this.count = count;
    mesh.setVerticesBuffer(new VertexBuffer(engine, cur.getBuffer(), VertexBuffer.PositionKind, false, false, 4, false, 0, 3));
  }

  positions(count, data) {
    const b = new StorageBuffer(this.engine, Math.max(16, count * 16), RW);
    if (data) b.update(pack4(data));
    return b;
  }

  buffer(data) {
    const b = new StorageBuffer(this.engine, Math.max(16, data.byteLength), RO);
    b.update(data);
    return b;
  }

  newShader(kind) {
    const cs = new ComputeShader(kind, this.engine, { computeSource: KERNELS[kind] }, { bindingsMapping: BINDINGS[kind] });
    (this.shaders ??= []).push(cs);
    return cs;
  }

  // Resolves once every kernel is compiled (a dispatch before that does nothing).
  async whenReady() {
    while (!(this.shaders ?? []).every((cs) => cs.isReady())) await new Promise((ok) => setTimeout(ok, 10));
  }

  compileARMATURE(step, rest) {
    const synthetic = { mesh: this.deform.mesh, base: rest, modifiers: [step], steps: [step], shapeKeys: null };
    const binding = buildBinding(this.inst, synthetic);
    const nv = rest.length / 3, idx = new Uint32Array(nv * 8), wgt = new Float32Array(nv * 8);
    for (let i = 0; i < nv * MAX_INFLUENCES; i++) { idx[i] = binding.indices[i]; wgt[i] = binding.weights[i]; }
    if (binding.dq) {
      const dq = new StorageBuffer(this.engine, Math.max(1, binding.joints.length) * 96, RO), pre = new StorageBuffer(this.engine, 128, RO);
      const update = () => {
        const d = dualQuatData(this.inst, synthetic, binding);
        dq.update(d.data);
        pre.update(new Float32Array([...d.pre, ...d.preInv]));
      };
      return { cs: this.newShader('skinDQ'), buffers: { dq, idx: this.buffer(idx), wgt: this.buffer(wgt), pre }, update };
    }
    const joints = new StorageBuffer(this.engine, (binding.joints.length + 1) * 64, RO);
    const cs = this.newShader('skin');
    const buffers = { joints, idx: this.buffer(idx), wgt: this.buffer(wgt) };
    return { cs, buffers, update: () => joints.update(jointMatrices(this.inst, synthetic, binding)), rest: null };
  }

  compileStencil(step, rest) {
    const st = step.stencil, terms = new Float32Array(st.src.length * 4);
    for (let k = 0; k < st.src.length; k++) { terms[k * 4] = st.src[k]; terms[k * 4 + 1] = st.weight[k]; terms[k * 4 + 2] = st.flip[k]; }
    const frames = new StorageBuffer(this.engine, 128, RO);
    const identity = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    frames.update(new Float32Array([...identity, ...identity]));
    const update = step.mirrorObject === undefined ? () => {} : () => {
      const F = new Float64Array(16), Fi = new Float64Array(16), w = this.inst.world;
      invertAffine(Fi, 0, w, step.mirrorObject * 16);
      mulAffine(F, 0, Fi, 0, w, this.deform.mesh * 16);
      invertAffine(Fi, 0, F, 0);
      frames.update(new Float32Array([...F, ...Fi]));
    };
    const frame = step.mirrorObject === undefined ? null : this.inst.program.restFrame(this.deform.mesh, step.mirrorObject);
    return { cs: this.newShader('stencil'), buffers: { start: this.buffer(Uint32Array.from(st.start)), terms: this.buffer(terms), frames }, update, count: st.count, rest: applyStencil(st, rest, frame) };
  }

  compileMASK(step, rest) { return this.compileStencil(step, rest); }
  compileMIRROR(step, rest) { return this.compileStencil(step, rest); }
  compileSUBSURF(step, rest) { return this.compileStencil(step, rest); }

  compileLATTICE(step, rest) {
    const nv = rest.length / 3;
    const mask = this.buffer(Float32Array.from({ length: nv }, (_, v) => (step.mask ? step.mask[v] : 1)));
    const L0 = latticeFrame(this.inst, step.lattice);
    const disp = new StorageBuffer(this.engine, L0.disp.length / 3 * 16, RO), mats = new StorageBuffer(this.engine, 128, RO), prm = new StorageBuffer(this.engine, 64, RO);
    const KIND = { KEY_LINEAR: 0, KEY_CARDINAL: 1, KEY_CATMULL_ROM: 2, KEY_BSPLINE: 3 };
    const update = () => {
      const L = latticeFrame(this.inst, step.lattice), n = L.disp.length / 3, d = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) { d.set(L.disp.subarray(i * 3, i * 3 + 3), i * 4); d[i * 4 + 3] = L.group ? L.group[i] ?? 0 : 1; }
      disp.update(d);
      const toLat = new Float64Array(16), inv = new Float64Array(16), back = new Float64Array(16), w = this.inst.world;
      invertAffine(inv, 0, w, step.lattice * 16);
      mulAffine(toLat, 0, inv, 0, w, this.deform.mesh * 16);
      invertAffine(back, 0, toLat, 0);
      mats.update(new Float32Array([...toLat, ...back]));
      prm.update(new Float32Array([L.nu, L.nv, L.nw, L.group ? 1 : 0, ...L.interp.map((k) => KIND[k] ?? 3), step.strength,
        L.range[0][0], L.range[1][0], L.range[2][0], 0, L.range[0][1], L.range[1][1], L.range[2][1], 0]));
    };
    return { cs: this.newShader('lattice'), buffers: { disp, mats, prm, mask }, update };
  }

  compileCORRECTIVE_SMOOTH(step, rest) {
    const nv = rest.length / 3;
    const nbStart = new Uint32Array(nv + 1), nb = [];
    step.neighbours.forEach((list, v) => { nbStart[v] = nb.length; nb.push(...list); });
    nbStart[nv] = nb.length;
    const factor = new Float32Array(nv * 2);
    for (let v = 0; v < nv; v++) { factor[v * 2] = step.factor[v]; factor[v * 2 + 1] = step.lengthWeighted ? 1 : 0; }
    // Per corner: previous and next vertex, and the rest offset in the rest corner frame (Fr^T (R - Rs)).
    const R = step.rest, Rs = step.restSmooth;
    const cStart = new Uint32Array(nv + 1), corners = [];
    step.corners.forEach((list, v) => {
      cStart[v] = corners.length / 8;
      const off = [R[v * 3] - Rs[v * 3], R[v * 3 + 1] - Rs[v * 3 + 1], R[v * 3 + 2] - Rs[v * 3 + 2]];
      for (const [prev, next] of list) {
        const F = cornerFrame(Rs, v, prev, next);
        corners.push(prev, next, 0, 0, ...F.map((c) => c[0] * off[0] + c[1] * off[1] + c[2] * off[2]), 0);
      }
    });
    cStart[nv] = corners.length / 8;
    const smoothCs = this.newShader('smooth'), correctCs = this.newShader('correct'), copyCs = step.onlySmooth ? this.newShader('stencil') : null;
    const ping = this.positions(nv), pong = this.positions(nv);
    const buffers = { start: this.buffer(nbStart), nb: this.buffer(Uint32Array.from(nb.length ? nb : [0])), factor: this.buffer(factor) };
    const cBuffers = { start: this.buffer(cStart), corners: this.buffer(Float32Array.from(corners.length ? corners : [0, 0, 0, 0, 0, 0, 0, 0])), prm: this.buffer(new Float32Array([step.scale, 0, 0, 0])) };
    return {
      update: () => {},
      run: (src, dst) => {
        let a = src, b = ping;
        for (let i = 0; i < step.iterations; i++) {
          this.dispatch(smoothCs, { src: a, dst: b, ...buffers }, nv);
          a = b; b = b === ping ? pong : ping;
        }
        if (step.onlySmooth) this.dispatch(copyCs, { src: a, dst, ...this.identityStencil(nv) }, nv);
        else this.dispatch(correctCs, { src: a, dst, ...cBuffers }, nv);
      },
    };
  }

  identityStencil(nv) {
    if (this.identity?.n === nv) return this.identity.buffers;
    const terms = new Float32Array(nv * 4);
    for (let v = 0; v < nv; v++) { terms[v * 4] = v; terms[v * 4 + 1] = 1; }
    const frames = this.buffer(new Float32Array(32));
    this.identity = { n: nv, buffers: { start: this.buffer(Uint32Array.from({ length: nv + 1 }, (_, i) => i)), terms: this.buffer(terms), frames } };
    return this.identity.buffers;
  }

  dispatch(cs, buffers, n) {
    for (const [name, b] of Object.entries(buffers)) cs.setStorageBuffer(name, b);
    cs.dispatch(Math.ceil(n / WG));
  }

  // Runs the stack for this frame (after inst.evaluate()).
  update() {
    for (const p of this.passes) {
      p.update();
      if (p.run) p.run(p.src, p.dst);
      else this.dispatch(p.cs, { src: p.src, dst: p.dst, ...p.buffers }, p.n);
    }
  }

  // Positions read back (tests): Float32Array of xyz.
  async read() {
    this.engine.flushFramebuffer?.();
    const raw = await this.output.read(undefined, undefined, undefined, true);
    const f = new Float32Array(raw.buffer, raw.byteOffset, this.count * 4), out = new Float32Array(this.count * 3);
    for (let v = 0; v < this.count; v++) out.set(f.subarray(v * 4, v * 4 + 3), v * 3);
    return out;
  }
}

function pack4(xyz) {
  const n = xyz.length / 3, out = new Float32Array(n * 4);
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

// The CPU path with the same interface: the stack on the CPU, written into the mesh's positions each frame.
export class CpuDeformer {
  constructor(inst, deform, mesh) { this.inst = inst; this.deform = deform; this.mesh = mesh; }
  update() {
    const welded = deformMesh(this.inst, this.deform), pos = drawnPositions(this.deform, welded);
    this.mesh.updateVerticesData(VertexBuffer.PositionKind, Float32Array.from(pos), false, false);
    // Normals from the welded mesh (angle-weighted face normals), so seams split for UVs stay smooth.
    if (this.mesh.isVerticesDataPresent(VertexBuffer.NormalKind) && this.deform.geo.faces.length) {
      const n = drawnPositions(this.deform, vertexNormals(welded, this.deform.geo.faces));
      this.mesh.updateVerticesData(VertexBuffer.NormalKind, Float32Array.from(n), false, false);
    }
    return pos;
  }
}

