// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// Dual quaternion skinning on Babylon: Blender's Preserve Volume. Written from the published method (Kavan, Collins,
// Zara and O'Sullivan, "Geometric Skinning with Approximate Dual Quaternion Blending", ACM TOG 27(4), 2008: each
// bone's rigid motion a unit dual quaternion, blended linearly, sign-aligned to the strongest, normalized; its scale
// and shear blended linearly before it) and checked against the deform Blender evaluates; not from Blender's code.
// Each frame a skinned mesh's bone matrices are split into a dual quaternion and a symmetric 3x3 scale, packed in a
// float texture laid out as Babylon's bone texture (4 texels a bone); its material's bones code blends them in place of
// the matrices: a material plugin for PBR and Standard materials, a bones block for node materials.
import { BonesBlock, Constants, InputBlock, MaterialPluginBase, NodeMaterial, PBRBaseMaterial, RawTexture, RegisterMaterialPlugin, StandardMaterial } from '@babylonjs/core';

const DEFINE = 'BYLONDER_DQS', SAMPLER = 'dqsSampler', PLUGIN = 'BylonderDualQuaternionSkinning';

/**
 * A 3x3 matrix's rotation and scale, A = R S with S symmetric (the polar decomposition, by Higham's iteration).
 * @param {number[]} a column-major 3x3
 */
export function polar(a) {
  let r = a.slice();
  for (let k = 0; k < 30; k++) {
    const inv = inverse3(r);
    if (!inv) break;
    // (R + R^-T) / 2
    const next = r.map((v, i) => (v + inv[(i % 3) * 3 + Math.floor(i / 3)]) / 2);
    const change = next.reduce((s, v, i) => s + Math.abs(v - r[i]), 0);
    r = next;
    if (change < 1e-12) break;
  }
  // S = R^T A
  const s = Array.from({ length: 9 }, (_, i) => {
    const row = i % 3, col = Math.floor(i / 3);
    return r[row * 3] * a[col * 3] + r[row * 3 + 1] * a[col * 3 + 1] + r[row * 3 + 2] * a[col * 3 + 2];
  });
  return { r, s };
}
/** @param {number[]} m column-major 3x3 */
function inverse3(m) {
  const [a, b, c, d, e, f, g, h, i] = m, A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g, det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-20) return null;
  // Column-major inverse: the transposed cofactors over the determinant.
  return [A, -(b * i - c * h), b * f - c * e, B, a * i - c * g, -(a * f - c * d), C, -(a * h - b * g), a * e - b * d].map((v) => v / det);
}
/** A rotation's unit quaternion (x, y, z, w). @param {number[]} r column-major 3x3 */
function quaternion(r) {
  const q = new Array(4), trace = r[0] + r[4] + r[8];
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    q[3] = s / 4; q[0] = (r[5] - r[7]) / s; q[1] = (r[6] - r[2]) / s; q[2] = (r[1] - r[3]) / s;
  } else if (r[0] > r[4] && r[0] > r[8]) {
    const s = Math.sqrt(1 + r[0] - r[4] - r[8]) * 2;
    q[3] = (r[5] - r[7]) / s; q[0] = s / 4; q[1] = (r[3] + r[1]) / s; q[2] = (r[6] + r[2]) / s;
  } else if (r[4] > r[8]) {
    const s = Math.sqrt(1 + r[4] - r[0] - r[8]) * 2;
    q[3] = (r[6] - r[2]) / s; q[0] = (r[3] + r[1]) / s; q[1] = s / 4; q[2] = (r[7] + r[5]) / s;
  } else {
    const s = Math.sqrt(1 + r[8] - r[0] - r[4]) * 2;
    q[3] = (r[1] - r[3]) / s; q[0] = (r[6] + r[2]) / s; q[1] = (r[7] + r[5]) / s; q[2] = s / 4;
  }
  return q;
}

/**
 * Skin matrices (Babylon's, 16 floats each: a column-major matrix acting on column vectors) packed for the shader:
 * per bone the real and dual parts of its unit dual quaternion, then its scale's six entries (s00 s01 s02 s11 s12 s22).
 * @param {ArrayLike<number>} matrices @param {Float32Array} [out]
 */
export function packDualQuaternions(matrices, out = new Float32Array(matrices.length)) {
  for (let b = 0; b < matrices.length / 16; b++) {
    const m = (/** @type {number} */ i) => matrices[b * 16 + i];
    const { r, s } = polar([m(0), m(1), m(2), m(4), m(5), m(6), m(8), m(9), m(10)]), q = quaternion(r), t = [m(12), m(13), m(14)];
    // The dual part: (0, t) q / 2.
    const d = [
      (t[0] * q[3] + t[1] * q[2] - t[2] * q[1]) / 2, (-t[0] * q[2] + t[1] * q[3] + t[2] * q[0]) / 2,
      (t[0] * q[1] - t[1] * q[0] + t[2] * q[3]) / 2, (-t[0] * q[0] - t[1] * q[1] - t[2] * q[2]) / 2,
    ];
    out.set([...q, ...d, s[0], s[3], s[6], s[4], s[7], s[8], 0, 0], b * 16);
  }
  return out;
}

/**
 * A point skinned by packed dual quaternions, as the shader skins it: the CPU reference of the same math.
 * @param {Float32Array} packed @param {[number, number][]} influences bone index and weight, strongest first
 * @param {number[]} p
 */
export function skinPoint(packed, influences, p) {
  const at = (/** @type {number} */ b, /** @type {number} */ i) => packed[b * 16 + i];
  const real = [0, 0, 0, 0], dual = [0, 0, 0, 0], scale = [0, 0, 0, 0, 0, 0];
  const pivot = influences[0][0];
  for (const [b, w] of influences) {
    const aligned = [0, 1, 2, 3].reduce((s, i) => s + at(pivot, i) * at(b, i), 0) < 0 ? -w : w;
    for (let i = 0; i < 4; i++) { real[i] += at(b, i) * aligned; dual[i] += at(b, 4 + i) * aligned; }
    for (let i = 0; i < 6; i++) scale[i] += at(b, 8 + i) * w;
  }
  const n = Math.hypot(...real);
  const [x, y, z, w] = real.map((v) => v / n), [dx, dy, dz, dw] = dual.map((v) => v / n);
  const [s00, s01, s02, s11, s12, s22] = scale;
  const sp = [s00 * p[0] + s01 * p[1] + s02 * p[2], s01 * p[0] + s11 * p[1] + s12 * p[2], s02 * p[0] + s12 * p[1] + s22 * p[2]];
  // The rotation of (x, y, z, w) applied, then the translation 2 (w d - dw v + v x d).
  const cross = (/** @type {number[]} */ a, /** @type {number[]} */ b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const v = [x, y, z], c1 = cross(v, sp), c2 = cross(v, c1.map((c, i) => c + w * sp[i]));
  const rotated = sp.map((s, i) => s + 2 * c2[i]);
  const t = cross(v, [dx, dy, dz]).map((c, i) => 2 * (w * [dx, dy, dz][i] - dw * v[i] + c));
  return rotated.map((r, i) => r + t[i]);
}

// The blend as GLSL and WGSL: `bylonderDqs(indices, weights, extra indices, extra weights)` gives the skin matrix.
const GLSL = `mat4 bylonderDqs(vec4 i0,vec4 w0,vec4 i1,vec4 w1){
mat4 p=readMatrixFromRawSampler(${SAMPLER},i0[0]);vec4 r=vec4(0.),d=vec4(0.),s0=vec4(0.),s1=vec4(0.);
for(int k=0;k<8;k++){float w=k<4?w0[k]:w1[k-4];if(w==0.){continue;}
mat4 m=readMatrixFromRawSampler(${SAMPLER},k<4?i0[k]:i1[k-4]);float a=dot(p[0],m[0])<0.?-w:w;
r+=m[0]*a;d+=m[1]*a;s0+=m[2]*w;s1+=m[3]*w;}
float n=length(r);r/=n;d/=n;vec3 v=r.xyz;
mat3 R=mat3(1.-2.*(v.y*v.y+v.z*v.z),2.*(v.x*v.y+r.w*v.z),2.*(v.x*v.z-r.w*v.y),
2.*(v.x*v.y-r.w*v.z),1.-2.*(v.x*v.x+v.z*v.z),2.*(v.y*v.z+r.w*v.x),
2.*(v.x*v.z+r.w*v.y),2.*(v.y*v.z-r.w*v.x),1.-2.*(v.x*v.x+v.y*v.y));
mat3 A=R*mat3(s0.x,s0.y,s0.z,s0.y,s0.w,s1.x,s0.z,s1.x,s1.y);vec3 t=2.*(r.w*d.xyz-d.w*v+cross(v,d.xyz));
return mat4(vec4(A[0],0.),vec4(A[1],0.),vec4(A[2],0.),vec4(t,1.));}
`;
const WGSL = `fn bylonderDqs(i0:vec4f,w0:vec4f,i1:vec4f,w1:vec4f)->mat4x4f{
let p=readMatrixFromRawSampler(${SAMPLER},i0[0]);var r=vec4f(0.);var d=vec4f(0.);var s0=vec4f(0.);var s1=vec4f(0.);
for(var k=0;k<8;k++){var w=0.;var i=0.;if(k<4){w=w0[k];i=i0[k];}else{w=w1[k-4];i=i1[k-4];}if(w==0.){continue;}
let m=readMatrixFromRawSampler(${SAMPLER},i);let a=select(w,-w,dot(p[0],m[0])<0.);
r+=m[0]*a;d+=m[1]*a;s0+=m[2]*w;s1+=m[3]*w;}
let n=length(r);r/=n;d/=n;let v=r.xyz;
let R=mat3x3f(1.-2.*(v.y*v.y+v.z*v.z),2.*(v.x*v.y+r.w*v.z),2.*(v.x*v.z-r.w*v.y),
2.*(v.x*v.y-r.w*v.z),1.-2.*(v.x*v.x+v.z*v.z),2.*(v.y*v.z+r.w*v.x),
2.*(v.x*v.z+r.w*v.y),2.*(v.y*v.z-r.w*v.x),1.-2.*(v.x*v.x+v.y*v.y));
let A=R*mat3x3f(s0.x,s0.y,s0.z,s0.y,s0.w,s1.x,s0.z,s1.x,s1.y);let t=2.*(r.w*d.xyz-d.w*v+cross(v,d.xyz));
return mat4x4f(vec4f(A[0],0.),vec4f(A[1],0.),vec4f(A[2],0.),vec4f(t,1.));}
`;
/** The call that sets `variable`, the blended skin matrix, in a shader language. @param {string} variable @param {boolean} wgsl */
const blend = (variable, wgsl) => {
  const a = wgsl ? 'vertexInputs.' : '', none = wgsl ? 'vec4f(0.)' : 'vec4(0.)';
  return `#ifdef ${DEFINE}\n#if NUM_BONE_INFLUENCERS>4\n${variable}=bylonderDqs(${a}matricesIndices,${a}matricesWeights,${a}matricesIndicesExtra,${a}matricesWeightsExtra);\n#else\n${variable}=bylonderDqs(${a}matricesIndices,${a}matricesWeights,${none},${none});\n#endif\n#endif\n`;
};

/** Meshes skinned by dual quaternions, with their packed texture and the frame it holds. */
const skinned = new WeakMap();

/**
 * Turns dual quaternion skinning on or off for a skinned mesh: its materials blend the bones' dual quaternions (a PBR
 * or Standard material by the plugin; a NodeMaterial's BonesBlock is swapped for DualQuaternionBonesBlock, which
 * draws its other meshes as BonesBlock does, so files keep Babylon's own block).
 * @param {import('@babylonjs/core').AbstractMesh} mesh @param {boolean} on
 */
export function useDualQuaternionSkinning(mesh, on) {
  if (!on) {
    skinned.get(mesh)?.texture?.dispose();
    skinned.delete(mesh);
  } else if (!skinned.has(mesh)) skinned.set(mesh, { texture: null, frame: -1 });
  // The shader reads the dual quaternions as it reads the bones' texture.
  if (on && mesh.skeleton) mesh.skeleton.useTextureToStoreBoneMatrices = true;
  for (const material of mesh.material ? [mesh.material, ...(/** @type {any} */ (mesh.material).subMaterials ?? [])] : []) {
    if (skinsWithPlugin(material)) pluginOf(material);
    if (on && material instanceof NodeMaterial) dualQuaternionBones(material);
    material?.markAsDirty(Constants.MATERIAL_AttributesDirtyFlag);
  }
}
/** A node material's BonesBlock replaced by DualQuaternionBonesBlock, linked as it was. @param {NodeMaterial} material */
function dualQuaternionBones(material) {
  const old = material.attachedBlocks.find((b) => b instanceof BonesBlock && !(b instanceof DualQuaternionBonesBlock));
  if (!old) return;
  const block = new DualQuaternionBonesBlock(old.name);
  old.inputs.forEach((input, i) => {
    const from = input.connectedPoint;
    if (from) { from.disconnectFrom(input); from.connectTo(block.inputs[i]); }
  });
  old.outputs.forEach((output, i) => [...output.endpoints].forEach((to) => { output.disconnectFrom(to); block.outputs[i].connectTo(to); }));
  block.autoConfigure(material);
  material.build();
}
/** @param {import('@babylonjs/core').AbstractMesh | null | undefined} mesh */
const usesDualQuaternions = (mesh) => !!mesh && skinned.has(mesh) && !!mesh.skeleton && mesh.numBoneInfluencers > 0 && mesh.skeleton.isUsingTextureForMatrices;

/** The mesh's packed texture for this frame. @param {import('@babylonjs/core').AbstractMesh} mesh */
function textureOf(mesh) {
  const state = skinned.get(mesh), scene = mesh.getScene(), skeleton = /** @type {import('@babylonjs/core').Skeleton} */ (mesh.skeleton);
  if (state.frame === scene.getFrameId() && state.texture) return state.texture;
  const matrices = skeleton.getTransformMatrices(mesh), count = matrices.length / 4;
  if (state.texture?.getSize().width !== count) {
    state.texture?.dispose();
    state.data = new Float32Array(matrices.length);
    state.texture = RawTexture.CreateRGBATexture(state.data, count, 1, scene, false, false, Constants.TEXTURE_NEAREST_SAMPLINGMODE, Constants.TEXTURETYPE_FLOAT);
  }
  state.texture.update(packDualQuaternions(matrices, state.data));
  state.frame = scene.getFrameId();
  return state.texture;
}

/** A PBR or Standard material's dual quaternion skinning. */
export class DualQuaternionSkinningPlugin extends MaterialPluginBase {
  /** @param {import('@babylonjs/core').Material} material */
  constructor(material) {
    super(material, PLUGIN, 200, { [DEFINE]: false }, true, true);
  }
  /** @param {any} defines @param {any} scene @param {import('@babylonjs/core').AbstractMesh} mesh */
  prepareDefines(defines, scene, mesh) {
    defines[DEFINE] = usesDualQuaternions(mesh);
  }
  /** @param {string[]} samplers */
  getSamplers(samplers) {
    samplers.push(SAMPLER);
  }
  /** @param {any} uniformBuffer @param {any} scene @param {any} engine @param {import('@babylonjs/core').SubMesh} subMesh */
  bindForSubMesh(uniformBuffer, scene, engine, subMesh) {
    const mesh = subMesh.getMesh();
    if (usesDualQuaternions(mesh)) uniformBuffer.setTexture(SAMPLER, textureOf(mesh));
  }
  isCompatible() {
    return true;
  }
  /** @param {string} shaderType @param {number} [language] 1: WGSL */
  getCustomCode(shaderType, language) {
    if (shaderType !== 'vertex') return null;
    const wgsl = language === 1;
    return {
      CUSTOM_VERTEX_DEFINITIONS: `#ifdef ${DEFINE}\n${wgsl ? `var ${SAMPLER}:texture_2d<f32>;` : `uniform sampler2D ${SAMPLER};`}\n#endif\n`,
      [wgsl ? '!@vertex' : '!void main\\('] : `#ifdef ${DEFINE}\n${wgsl ? WGSL : GLSL}#endif\n${wgsl ? '@vertex' : 'void main('}`,
      '!finalWorld=finalWorld\\*influence;': `${blend('influence', wgsl)}finalWorld=finalWorld*influence;`,
    };
  }
}
/** @param {import('@babylonjs/core').Material} material */
const skinsWithPlugin = (material) => material instanceof PBRBaseMaterial || material instanceof StandardMaterial;
/** @param {import('@babylonjs/core').Material} material */
const pluginOf = (material) => material.pluginManager?.getPlugin(PLUGIN) ?? new DualQuaternionSkinningPlugin(material);
// Every PBR and Standard material made from now on carries it, off until a mesh it draws skins with dual quaternions.
RegisterMaterialPlugin(PLUGIN, (material) => (skinsWithPlugin(material) ? new DualQuaternionSkinningPlugin(material) : null));

/** A node material's bones, blended as dual quaternions on the meshes that use them, else as Babylon's BonesBlock. */
export class DualQuaternionBonesBlock extends BonesBlock {
  // Saved as Babylon's BonesBlock, so a file loads with Babylon alone; a page swaps it back for the meshes that use it.
  getClassName() {
    return 'BonesBlock';
  }
  /** Babylon's, and the extra four influences' attributes, which a mesh of up to 8 influences reads. @param {any} material @param {any} [filter] */
  autoConfigure(material, filter = () => true) {
    super.autoConfigure(material, filter);
    for (const name of ['matricesIndicesExtra', 'matricesWeightsExtra']) {
      const point = this.getInputByName(name);
      if (!point || point.isConnected) continue;
      const attribute = material.getInputBlockByPredicate((/** @type {any} */ b) => b.isAttribute && b.name === name && filter(b)) ?? new InputBlock(name);
      attribute.setAsAttribute(name);
      attribute.output.connectTo(point);
    }
  }
  /** @param {any} defines @param {any} nodeMaterial @param {import('@babylonjs/core').AbstractMesh} mesh */
  prepareDefines(defines, nodeMaterial, mesh) {
    super.prepareDefines(defines, nodeMaterial, mesh);
    if (mesh) defines.setValue(DEFINE, usesDualQuaternions(mesh), true);
  }
  /** @param {import('@babylonjs/core').Effect} effect @param {any} nodeMaterial @param {import('@babylonjs/core').Mesh} mesh */
  bind(effect, nodeMaterial, mesh) {
    super.bind(effect, nodeMaterial, mesh);
    if (usesDualQuaternions(mesh)) effect.setTexture(SAMPLER, textureOf(mesh));
  }
  /** @param {any} state */
  _buildBlock(state) {
    const start = state.compilationString.length;
    super._buildBlock(state);
    const wgsl = state.shaderLanguage === 1, code = state.compilationString.slice(start);
    // The block's own line after the include, `<output> = <world> * <influence>;` before `#else`.
    const own = /\*\s*(\w+);\n#else\n/.exec(code);
    if (!own) return this;
    const variable = own[1];
    state._emit2DSampler(SAMPLER, DEFINE);
    state._emitFunction('bylonderDqs', `#ifdef ${DEFINE}\n${wgsl ? WGSL : GLSL}#endif\n`, `//${this.name}`);
    const at = start + code.lastIndexOf('#if NUM_BONE_INFLUENCERS>0\n', own.index);
    state.compilationString = state.compilationString.slice(0, at) + blend(variable, wgsl) + state.compilationString.slice(at);
    return this;
  }
}
